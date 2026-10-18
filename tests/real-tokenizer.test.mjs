/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createRedactionSession } from '../js/mztap-privacy-redaction.js';

// Optional offline fixture: no network access or inference weights. Hashes bind
// both files to the model revision recorded in VENDORS_INFO.md, not floating main.
const fixture = process.env.PRIVACY_TOKENIZER_PATH;
test('pinned real tokenizer: whitespace/Unicode alignment and safe failure', {
    skip: !fixture && 'Set PRIVACY_TOKENIZER_PATH to the pinned tokenizer.json'
}, async () => {
    const [json, config] = await Promise.all([
        readFile(fixture), readFile(join(dirname(fixture), 'tokenizer_config.json'))
    ]);
    const sha256 = value => createHash('sha256').update(value).digest('hex');
    assert.equal(sha256(json), 'e977adcc6faffc532cb774decca6a9e4f44ad6075930d625dee7cb1ac3aa6121');
    assert.equal(sha256(config), '14b147f2a4f939d9b12ab36e9633917040dd948fa78ce283b03402e4cf2c9cba');
    const { PreTrainedTokenizer } = await import('../js/lib/transformers/transformers.min.js');
    const tokenizer = new PreTrainedTokenizer(JSON.parse(json), JSON.parse(config));
    const chunks = [];
    const classify = async text => {
        chunks.push(text);
        const ids = tokenizer.encode(text);
        assert.ok(ids.length <= 64);
        const decode = end => end === 0 ? '' : tokenizer.decode(ids.slice(0, end), { skip_special_tokens: true });
        const decoded = decode(ids.length);
        const predictions = [];
        for (const match of decoded.matchAll(/Alice/g)) {
            let first = true;
            for (let index = 0; index < ids.length; ++index) {
                if (decode(index + 1).length > match.index && decode(index).length < match.index + 5) {
                    predictions.push({ index, entity: `${first ? 'B' : 'I'}-GIVEN_NAME` });
                    first = false;
                }
            }
        }
        return predictions;
    };
    classify.tokenizer = tokenizer;
    classify.model = { config: { max_position_embeddings: 64 } };
    const session = createRedactionSession(async () => classify, '12345678');
    for (const text of [
        'Grüße Alice … äöüß\r\n\t  Alice\n\n',
        'Alice\u00a0NBSP\u200bZWSP\u00adsoft hyphen',
        '👋🏽 Alice 👨‍👩‍👧‍👦 café e\u0301 ﬁ ™ ½',
        '日本語 Alice 中文 العربية עברית 한글 हिन्दी',
        '> Alice wrote:\r\n> quoted text\r\n\r\n  Thanks, Alice',
        'Alice<br>Line<BR />next<br/>  <b>Alice</b>',
        'Hello Alice\n\nQuoted mail alice@example.test\n'.repeat(20)
    ]) {
        const result = await session.mask(text);
        assert.ok(!result.text.includes('Alice'));
        assert.equal(result.restore(result.text), text);
    }
    assert.ok(chunks.length > 10, 'exercise overlapping real-tokenizer chunks too');
    for (const literal of ['<eos>', '<mask>']) {
        await assert.rejects(session.mask(`Literal ${literal} token`), error => error.code === 'TEXT_UNSUPPORTED');
    }
});
