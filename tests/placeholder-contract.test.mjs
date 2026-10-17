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

test('HTML escaping applies to originals, not to the surrounding HTML', () => {
    assert.equal(restorePrivacyPlaceholders(`<p>${TOKEN}</p>`, mappings, value => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;')),
        '<p>Alice &lt;Example&gt;</p>');
});

test('service blocks changed tokens before returning output or opening a restored view in every format', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    for (const format of ['text', 'html', 'json']) {
        const result = await h.call('after', { requestId: 'request', context: prepared.context, format,
            output: { content: format === 'json' ? JSON.stringify([TOKEN.toLowerCase()]) : TOKEN.toLowerCase(), thinking: '' },
            view: { original: '', diff: false } });
        assert.equal(result.error.code, 'UNRESTORED_PLACEHOLDER');
        assert.equal(result.error.message, 'privacy_unrestored_placeholder');
    }
    assert.equal(h.windows.length, 0);
});

test('display-only restoration preserves changed fragments and expands exact tokens only once', () => {
    const display = `${TOKEN} refers to ${TOKEN.slice(1, -1)} and ${TOKEN.toLowerCase()}`;
    assert.equal(restoreExactPrivacyPlaceholders(display, mappings),
        `Alice <Example> refers to ${TOKEN.slice(1, -1)} and ${TOKEN.toLowerCase()}`);
    assert.equal(restoreExactPrivacyPlaceholders(TOKEN, [[TOKEN, TOKEN]]), TOKEN);
});

test('reasoning/error fragments do not block clean content or views in any format', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    const thinking = `Reason about ${TOKEN.slice(1, -1)}, then return ${TOKEN}`;
    const error = `Error mentioning ${TOKEN.toLowerCase()} and ${TOKEN}`;
    for (const format of ['text', 'html', 'json']) {
        const result = await h.call('after', { requestId: 'request', context: prepared.context, format,
            output: { content: format === 'json' ? JSON.stringify([TOKEN]) : TOKEN, thinking, error },
            view: { original: '', diff: false } });
        assert.equal(result.ok, true);
        assert.equal(result.output.content, format === 'json' ? '["Alice"]' : 'Alice');
        assert.equal(result.output.thinking, `Reason about ${TOKEN.slice(1, -1)}, then return Alice`);
        assert.equal(result.output.error, `Error mentioning ${TOKEN.toLowerCase()} and Alice`);
    }
    assert.equal(h.windows.length, 3);
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
