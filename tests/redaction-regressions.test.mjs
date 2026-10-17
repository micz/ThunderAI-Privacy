/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// Focused algorithm regressions with a scalar tokenizer/fixed labels. Not the
// removed model-quality corpus: no inference, network or trained weights.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRedactionSession } from '../js/mztap-privacy-redaction.js';

function classifier({ limit = 64, entities = () => [] } = {}) {
    const chunks = [];
    const fn = async text => {
        chunks.push(text);
        assert.ok(fn.tokenizer.encode(text).length <= limit);
        const predictions = [];
        const scalars = [...text];
        for (const { start, end, label } of entities(text)) {
            let offset = 0, first = true;
            scalars.forEach((scalar, index) => {
                const next = offset + scalar.length;
                if (next > start && offset < end) {
                    predictions.push({ index: index + 1, entity: `${first ? 'B' : 'I'}-${label}` });
                    first = false;
                }
                offset = next;
            });
        }
        return predictions;
    };
    fn.tokenizer = {
        encode: text => [0, ...[...text].map(char => char.codePointAt(0) + 2), 1],
        decode: ids => ids.filter(id => id > 1).map(id => String.fromCodePoint(id - 2)).join(''),
        model_max_length: limit
    };
    fn.model = { config: { max_position_embeddings: limit } };
    return { fn, chunks };
}
const spans = (text, pattern, label) => [...text.matchAll(pattern)].map(match => ({
    start: match.index, end: match.index + match[0].length, label
}));
const redactor = options => {
    const model = classifier(options);
    return { ...model, session: createRedactionSession(async () => model.fn, '12345678') };
};

test('bounded overlapping chunks mask names across window boundaries and preserve Unicode/whitespace', async () => {
    const { session, chunks } = redactor({ limit: 32, entities: text => spans(text, /Alice/g, 'GIVEN_NAME') });
    const original = '😀 Grüße\r\n  '.repeat(3) + 'Alice\t' + 'quoted reply Alice\n'.repeat(12);
    const result = await session.mask(original);
    assert.ok(chunks.length > 3);
    assert.ok(!result.text.includes('Alice'));
    assert.equal(result.restore(result.text), original);
    assert.equal(session.getMappings().filter(([, value]) => value === 'Alice').length, 1);
});

test('whole-word boundaries and oversized-word fallback make forward progress', async () => {
    const { session, chunks } = redactor({ limit: 32 });
    const original = Array.from({ length: 40 }, (_, index) => `Word${String(index).padStart(3, '0')}`).join(' ');
    assert.equal((await session.mask(original)).text, original);
    for (const chunk of chunks) {
        const start = original.indexOf(chunk), end = start + chunk.length;
        assert.ok(start === 0 || /\s/.test(original[start - 1]) || /\s/.test(chunk[0]));
        assert.ok(end === original.length || /\s/.test(original[end]) || /\s/.test(chunk.at(-1)));
    }
    assert.equal((await session.mask('😀'.repeat(150))).text, '😀'.repeat(150));
});

test('literal markup survives unchanged and replacements restore original text exactly', async () => {
    const { session } = redactor({ entities: text => spans(text, /Alice/g, 'GIVEN_NAME') });
    const original = 'Alice<br>Line<BR />next<br/>  <b>Alice</b>';
    const result = await session.mask(original);
    assert.ok(result.text.includes('<br>Line<BR />next<br/>'));
    assert.equal(result.restore(result.text), original);
});

test('deterministic rules mask mail/contact/card/signature values, not dates', async () => {
    for (const [original, sensitive] of [
        ['Mail <alice@example.test>', 'alice@example.test'],
        ['Telefon: +49 30 12345678', '+49 30 12345678'],
        ['Card: 4111 1111 1111 1111', '4111 1111 1111 1111'],
        ['Card ending in 1234', '1234'],
        ['Die letzten vier Ziffern der Kreditkarte sind 5678', '5678'],
        ['Support | Example Company', 'Example Company']
    ]) {
        const { session } = redactor({ limit: 128 });
        const result = await session.mask(original);
        assert.notEqual(result.text, original);
        assert.ok(session.getMappings().some(([, value]) => value === sensitive), original);
        assert.equal(result.restore(result.text), original);
    }
    const { session } = redactor();
    assert.equal((await session.mask('Date 2026-10-17; code 1234.')).text, 'Date 2026-10-17; code 1234.');
});

test('full-email rules dominate partial model spans without nesting placeholders', async () => {
    const { session } = redactor({ entities: text => spans(text, /alice/g, 'GIVEN_NAME') });
    const result = await session.mask('alice@example.test');
    assert.match(result.text, /^\[PII_12345678_EMAIL_1\]$/);
    assert.equal(result.restore(result.text), 'alice@example.test');
});

test('repetition respects case, Unicode boundaries and conversation isolation', async () => {
    let predict = true;
    const model = classifier({ entities: text => predict ? spans(text, /Ann/g, 'GIVEN_NAME') : [] });
    const remembered = createRedactionSession(async () => model.fn, '12345678');
    await remembered.mask('Ann'); predict = false;
    const result = await remembered.mask('Ann annual Annette éAnn Anné ann');
    assert.equal(result.text, '[PII_12345678_GIVEN_NAME_1] annual Annette éAnn Anné ann');
    const isolated = createRedactionSession(async () => model.fn, 'abcdef12');
    assert.equal((await isolated.mask('Ann')).text, 'Ann');
});

test('reserved prefixes and deterministic alignment failures have stable text-error codes', async () => {
    const { session, fn } = redactor();
    await assert.rejects(session.mask('User typed PII_12345678_NAME_1'), error => error.code === 'TEXT_UNSUPPORTED');
    const decode = fn.tokenizer.decode;
    fn.tokenizer.decode = ids => decode(ids).replace('<eos>', '');
    await assert.rejects(session.mask('literal <eos>'), error => error.code === 'TEXT_UNSUPPORTED');
});

test('pre-cancellation performs no classification', async () => {
    const { session, chunks } = redactor();
    await assert.rejects(session.mask('Alice', { isCancelled: () => true }), error => error.code === 'privacy_cancelled');
    assert.equal(chunks.length, 0);
});
