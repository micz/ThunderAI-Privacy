/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// Provider identifiers need stable, non-reversible pseudonyms, not per-session
// placeholders. Persist only a random installation key, never original values.
let keyPromise;
function getKey() {
    keyPromise ??= (async () => {
        const stored = await browser.storage.local.get('privacyIdentifierKey');
        let bytes = stored.privacyIdentifierKey;
        if (bytes === undefined) {
            bytes = Array.from(crypto.getRandomValues(new Uint8Array(32)));
            await browser.storage.local.set({ privacyIdentifierKey: bytes });
        }
        if (!Array.isArray(bytes) || bytes.length !== 32 ||
            bytes.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
            const error = new Error(browser.i18n.getMessage('privacy_identifier_key_invalid'));
            error.code = 'IDENTIFIER_KEY_INVALID';
            throw error;
        }
        return crypto.subtle.importKey('raw', new Uint8Array(bytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    })();
    return keyPromise;
}

export async function pseudonymizePrivacyIdentifier(field, value) {
    if (value === '') return value;
    const digest = await crypto.subtle.sign('HMAC', await getKey(),
        new TextEncoder().encode(JSON.stringify([field, value])));
    return 'ta-privacy-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
