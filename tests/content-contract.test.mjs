/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { maskPrivacyExtraBody } from '../js/mztap-extra-body.js';

globalThis.browser = { i18n: { getMessage: key => key } };

const session = { mask: async text => ({ text: text.replaceAll('Alice', '[MASK]') }) };
test('extra bodies mask nested string values and preserve fixed vocabulary/numeric controls', async () => {
    const input = { messages: [{ role: 'user', content: 'Alice' }], temperature: 0.5,
        response_format: { name: 'Alice', schema: { properties: { name: { description: 'Alice' } } } } };
    const result = await maskPrivacyExtraBody(input, session);
    assert.ok(!JSON.stringify(result).includes('Alice'));
    assert.equal(result.messages[0].role, 'user');
    assert.equal(result.temperature, 0.5);
    assert.equal(input.messages[0].content, 'Alice', 'source object is not mutated');
});
test('only top-level metadata permits renaming; unsupported keys and collisions block', async () => {
    assert.deepEqual(await maskPrivacyExtraBody({ metadata: { Alice: 'Alice' } }, session), { metadata: { '[MASK]': '[MASK]' } });
    for (const input of [{ Alice: 'value' }, { properties: { metadata: { Alice: 'value' } } }]) {
        await assert.rejects(maskPrivacyExtraBody(input, session), error => error.code === 'EXTRA_BODY_KEY_UNSUPPORTED');
    }
    await assert.rejects(maskPrivacyExtraBody({ metadata: { Alice: 'one', '[MASK]': 'two' } }, session),
        error => error.code === 'EXTRA_BODY_KEY_COLLISION');
});

async function identifiers(local = {}) {
    let writes = 0;
    const context = vm.createContext({ crypto: webcrypto, TextEncoder, browser: {
        i18n: { getMessage: key => key }, storage: { local: {
            async get(key) { return { [key]: local[key] }; },
            async set(values) { ++writes; Object.assign(local, structuredClone(values)); }
        } }
    } });
    const module = new vm.SourceTextModule(await readFile(new URL('../js/mztap-identifiers.js', import.meta.url), 'utf8'), { context });
    await module.link(() => {}); await module.evaluate();
    return { pseudonymize: module.namespace.pseudonymizePrivacyIdentifier, local, writes: () => writes };
}
test('identifier pseudonyms are stable across concurrent calls/restarts, field-separated and installation-local', async () => {
    const first = await identifiers();
    const field = 'chatgpt_prompt_cache_key';
    const [a, b] = await Promise.all([first.pseudonymize(field, 'Alice'), first.pseudonymize(field, 'Alice')]);
    assert.equal(a, b); assert.match(a, /^ta-privacy-[0-9a-f]{64}$/);
    assert.equal(first.writes(), 1);
    assert.equal(await (await identifiers(first.local)).pseudonymize(field, 'Alice'), a);
    assert.notEqual(await first.pseudonymize('chatgpt_safety_identifier', 'Alice'), a);
    assert.notEqual(await (await identifiers()).pseudonymize(field, 'Alice'), a);
    assert.ok(!JSON.stringify(first.local).includes('Alice'));
    const body = await maskPrivacyExtraBody({ prompt_cache_key: 'Alice', safety_identifier: 'Alice', metadata: { prompt_cache_key: 'Alice' } },
        session, { maskIdentifier: first.pseudonymize });
    assert.equal(body.prompt_cache_key, a);
    assert.equal(body.safety_identifier, await first.pseudonymize('chatgpt_safety_identifier', 'Alice'));
    assert.equal(body.metadata.prompt_cache_key, '[MASK]');
});
test('empty identifiers remain empty and a damaged installation key blocks', async () => {
    const h = await identifiers();
    assert.equal(await h.pseudonymize('field', ''), '');
    assert.equal(h.writes(), 0);
    const damaged = await identifiers({ privacyIdentifierKey: [0] });
    await assert.rejects(damaged.pseudonymize('field', 'Alice'), error => error.code === 'IDENTIFIER_KEY_INVALID');
});
