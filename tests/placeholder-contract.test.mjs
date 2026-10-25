/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restorePrivacyPlaceholders, restoreExactPrivacyPlaceholders } from '../js/mztap-placeholders.js';
import { serviceHarness, TOKEN } from './helpers/service.mjs';

const mappings = [[TOKEN, 'Alice <Example>']];
test('exact tokens restore once, including possessives; unrelated namespaces remain literal', () => {
    assert.equal(restorePrivacyPlaceholders(`${TOKEN}'s message`, mappings), "Alice <Example>'s message");
    const other = '[PII_deadbeef_NAME_1]';
    assert.equal(restorePrivacyPlaceholders(other, mappings), other);
    assert.equal(restorePrivacyPlaceholders(TOKEN, [[TOKEN, TOKEN]]), TOKEN);
});

for (const fragment of [TOKEN.toLowerCase(), TOKEN.slice(1, -1),
    '[PII_12345678_NOM_1]', '[PII_12345678_NAME_99]', '[PII_12345678_',
    'PII-12345678-NAME-1', '&#91;PII_12345678_NAME_1&#93;']) {
    test(`changed/unknown owned placeholder blocks: ${fragment}`, () => {
        assert.throws(() => restorePrivacyPlaceholders(fragment, mappings),
            error => error.code === 'UNRESTORED_PLACEHOLDER');
    });
}

test('service blocks changed tokens before returning output in every format', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    for (const format of ['text', 'json']) {
        const result = await h.call('after', { requestId: 'request', context: prepared.context, format,
            output: { content: format === 'json' ? JSON.stringify([TOKEN.toLowerCase()]) : TOKEN.toLowerCase(), thinking: '' } });
        assert.equal(result.error.code, 'UNRESTORED_PLACEHOLDER');
        assert.equal(result.error.message, 'privacy_unrestored_placeholder');
    }
});

test('the html format of the removed ChatGPT Web integration is rejected', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    const result = await h.call('after', { requestId: 'request', context: prepared.context, format: 'html',
        output: { content: TOKEN, thinking: '' } });
    assert.equal(result.error.code, 'INVALID_REQUEST');
    assert.equal((await h.call('collectInput', { requestId: 'request', fields: [{ info: '' }] })).error.code, 'INVALID_REQUEST');
});

test('display-only restoration preserves changed fragments and expands exact tokens only once', () => {
    const display = `${TOKEN} refers to ${TOKEN.slice(1, -1)} and ${TOKEN.toLowerCase()}`;
    assert.equal(restoreExactPrivacyPlaceholders(display, mappings),
        `Alice <Example> refers to ${TOKEN.slice(1, -1)} and ${TOKEN.toLowerCase()}`);
    assert.equal(restoreExactPrivacyPlaceholders(TOKEN, [[TOKEN, TOKEN]]), TOKEN);
});

test('reasoning/error fragments do not block clean content in any format', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    const thinking = `Reason about ${TOKEN.slice(1, -1)}, then return ${TOKEN}`;
    const error = `Error mentioning ${TOKEN.toLowerCase()} and ${TOKEN}`;
    for (const format of ['text', 'json']) {
        const result = await h.call('after', { requestId: 'request', context: prepared.context, format,
            output: { content: format === 'json' ? JSON.stringify([TOKEN]) : TOKEN, thinking, error } });
        assert.equal(result.ok, true);
        assert.equal(result.output.content, format === 'json' ? '["Alice"]' : 'Alice');
        assert.equal(result.output.thinking, `Reason about ${TOKEN.slice(1, -1)}, then return Alice`);
        assert.equal(result.output.error, `Error mentioning ${TOKEN.toLowerCase()} and Alice`);
    }
});

test('deterministic text failures keep their stable code and actionable message', async () => {
    const h = await serviceHarness();
    await h.create();
    h.controls.mask = async () => {
        const error = new Error('Cannot align chunk'); error.code = 'TEXT_UNSUPPORTED'; throw error;
    };
    const result = await h.before();
    assert.equal(result.error.code, 'TEXT_UNSUPPORTED');
    assert.equal(result.error.message, 'privacy_text_unsupported');
});
