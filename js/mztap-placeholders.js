/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
export const privacyPlaceholderPattern = () => /\[PII_[0-9a-f]{8}_[A-Z0-9_]+\]/g;

// Display-only reasoning/errors may discuss token syntax. Restore known exact
// tokens once, without rejecting or guessing at any other text.
export function restoreExactPrivacyPlaceholders(text, mappings, transform = value => value) {
    const values = new Map(mappings);
    return text.replace(privacyPlaceholderPattern(), placeholder =>
        values.has(placeholder) ? transform(values.get(placeholder)) : placeholder);
}

// Never guess a changed token's original value. Inspect the unexpanded text so
// originals containing placeholder-like strings are not recursively interpreted.
export function restorePrivacyPlaceholders(text, mappings, transform = value => value) {
    const values = new Map(mappings);
    const namespaces = new Set();
    for (const placeholder of values.keys()) {
        const match = /^\[PII_([0-9a-f]{8})_[A-Z0-9_]+\]$/.exec(placeholder);
        if (match) namespaces.add(match[1]);
    }
    const remaining = text.replace(privacyPlaceholderPattern(), placeholder => values.has(placeholder) ? '' : placeholder);
    for (const nonce of namespaces) {
        if (new RegExp(`PII[\\s_-]*${nonce}`, 'i').test(remaining)) {
            const error = new Error('The AI changed a privacy placeholder; the response cannot be restored safely.');
            error.code = 'UNRESTORED_PLACEHOLDER';
            throw error;
        }
    }
    return restoreExactPrivacyPlaceholders(text, values, transform);
}
