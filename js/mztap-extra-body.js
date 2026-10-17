/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// These exact keys are generic API/schema vocabulary. Preserve them without
// privacy checks to avoid false positives that could break request semantics;
// their values are still privacy-filtered. Unlisted keys are checked, not
// automatically rejected: outside supported free-form maps, preserve them if
// unchanged or reject the request if masking would rename them. Supported
// free-form keys (currently top-level metadata) can be renamed by masking.
const FIXED_KEYS = new Set([
    'metadata', 'model', 'input', 'messages', 'instructions', 'stream', 'store',
    'temperature', 'top_p', 'max_tokens', 'max_output_tokens', 'previous_response_id',
    'reasoning', 'effort', 'summary', 'tools', 'tool_choice', 'parallel_tool_calls',
    'response_format', 'text', 'format', 'type', 'name', 'description', 'strict',
    'function', 'functions', 'parameters', 'schema', 'properties', 'required',
    'additionalProperties', 'items', 'enum', 'const', 'default', 'anyOf', 'allOf',
    'oneOf', 'not', '$schema', '$id', '$ref', '$defs', 'definitions', 'title',
    'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'minItems', 'maxItems',
    'uniqueItems', 'role', 'content', 'user', 'seed', 'stop', 'frequency_penalty',
    'presence_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'stream_options',
    'include_usage', 'service_tier', 'background', 'truncation', 'verbosity',
]);

export async function maskPrivacyExtraBody(body, session) {
    async function visit(value, path) {
        if (typeof value === 'string') return (await session.mask(value)).text;
        if (Array.isArray(value)) {
            const children = [];
            for (const [index, child] of value.entries()) children.push(await visit(child, [...path, index]));
            return children;
        }
        if (!value || typeof value !== 'object') return value;
        // Only a TOP-LEVEL metadata map has documented free-form keys. A
        // similarly named nested schema property is not an API metadata map.
        const freeFormKeys = path.length === 1 && path[0] === 'metadata';
        const entries = [];
        const keys = new Set();
        for (const [name, child] of Object.entries(value)) {
            let key = name;
            if (freeFormKeys || !FIXED_KEYS.has(name)) {
                const maskedKey = (await session.mask(name)).text;
                if (!freeFormKeys && maskedKey !== name) {
                    const error = new Error(browser.i18n.getMessage('privacy_extra_body_key_unsupported'));
                    error.code = 'EXTRA_BODY_KEY_UNSUPPORTED';
                    throw error;
                }
                if (freeFormKeys) key = maskedKey;
            }
            if (keys.has(key)) {
                const error = new Error(browser.i18n.getMessage('privacy_extra_body_key_collision'));
                error.code = 'EXTRA_BODY_KEY_COLLISION';
                throw error;
            }
            keys.add(key);
            entries.push([key, await visit(child, [...path, name])]);
        }
        return Object.fromEntries(entries);
    }
    return visit(body, []);
}
