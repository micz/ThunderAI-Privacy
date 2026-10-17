/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restorePrivacyResponse } from '../js/mztap-privacy-filter.js';

const token = '[PII_12345678_NAME_1]';
const original = 'Alice "Example"\n\\Path\t😀';
const session = { restore: value => value.replaceAll(token, original) };

for (const [name, value, expected] of [
    ['object', { name: token }, { name: original }],
    ['array', [token, { nested: [token] }], [original, { nested: [original] }]],
    ['string', token, original],
    ['number', 42, 42],
    ['boolean', true, true],
    ['null', null, null]
]) {
    test(`${name} JSON roots restore safely, including fenced output`, () => {
        const input = JSON.stringify(value);
        const restored = restorePrivacyResponse(input, session);
        assert.deepEqual(JSON.parse(restored), expected);
        assert.equal(restorePrivacyResponse('```json\n' + input + '\n```', session),
            '```json\n' + restored + '\n```');
    });
}

test('JSON keys, escaped literals, whitespace and exact numeric spelling are preserved', () => {
    const input = ` { "${token}" : ["${token}", "escaped \\"quote\\""], "large": 9007199254740993, "small": 1e-1000 } `;
    const output = restorePrivacyResponse(input, session);
    assert.equal(JSON.parse(output)[original][0], original);
    assert.ok(output.includes('9007199254740993'));
    assert.ok(output.includes('1e-1000'));
    assert.ok(output.startsWith(' { '));
    assert.ok(output.endsWith(' } '));
});

test('multiple fences are restored separately; prose remains ordinary text', () => {
    const input = `${token}\n\`\`\`json\n["${token}"]\n\`\`\`\n\`\`\`\n"${token}"\n\`\`\``;
    const output = restorePrivacyResponse(input, session);
    assert.ok(output.startsWith(original + '\n'));
    const blocks = [...output.matchAll(/```(?:json)?\n([\s\S]*?)```/g)];
    assert.deepEqual(JSON.parse(blocks[0][1]), [original]);
    assert.equal(JSON.parse(blocks[1][1]), original);
});

test('embedded objects/arrays retain legacy prose handling', () => {
    for (const value of [{ name: token }, [token]]) {
        const output = restorePrivacyResponse('Result: ' + JSON.stringify(value) + ' done.', session);
        assert.equal(output, 'Result: ' + restorePrivacyResponse(JSON.stringify(value), session) + ' done.');
    }
});

test('summaries and malformed JSON still use literal text restoration', () => {
    for (const input of [`Hello ${token}`, `{"name": "${token}",}`, `\`\`\`json\ninvalid ${token}\n\`\`\``]) {
        assert.equal(restorePrivacyResponse(input, session), session.restore(input));
    }
});

test('restoration is single-pass even when an original contains another placeholder', () => {
    const other = '[PII_12345678_NAME_2]';
    const local = { restore: value => value.replace(/\[PII_12345678_NAME_[12]\]/g,
        match => match === token ? other : 'Bob') };
    assert.deepEqual(JSON.parse(restorePrivacyResponse(JSON.stringify([token, other]), local)), [other, 'Bob']);
});
