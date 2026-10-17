/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
const pages = new Map();
const pageURL = browser.runtime.getURL('pages/privacy-web/index.html');
function viewError(code, key) {
    const error = new Error(browser.i18n.getMessage(key) || key);
    error.code = code;
    return error;
}
const cancelled = () => viewError('CANCELLED', 'privacy_cancelled');

function close(id, page) {
    pages.delete(id);
    page.reject?.(cancelled());
    if (page.windowId != null) void browser.windows.remove(page.windowId).catch(() => {});
}

export function closePrivacyViews(record, requestId) {
    for (const [id, page] of pages) {
        if (page.record === record && (requestId === undefined || page.requestId === requestId)) close(id, page);
    }
}

async function open(record, requestId, data, callbacks = {}) {
    if (record.disposed || [...record.calls.values()].some(call => call.requestId === requestId && call.cancelled)) throw cancelled();
    const id = crypto.randomUUID();
    const page = { record, requestId, data, ...callbacks };
    pages.set(id, page);
    try {
        const win = await browser.windows.create({ url: `${pageURL}?id=${encodeURIComponent(id)}`,
            type: 'popup', width: 720, height: 620 });
        page.windowId = win.id;
        if (!pages.has(id)) await browser.windows.remove(win.id);
    } catch (error) {
        pages.delete(id);
        page.reject?.(error);
        throw error;
    }
}

export function collectPrivacyInput(record, requestId, fields) {
    if (!Array.isArray(fields) || fields.length === 0 || fields.some(field => typeof field?.info !== 'string')) {
        throw viewError('INVALID_REQUEST', 'privacy_invalid_request');
    }
    return new Promise((resolve, reject) => {
        void open(record, requestId, { kind: 'input', fields }, { resolve, reject }).catch(reject);
    });
}

export function showPrivacyResult(record, requestId, text, view) {
    if (typeof view.original !== 'string' || typeof view.diff !== 'boolean') {
        throw viewError('INVALID_REQUEST', 'privacy_invalid_request');
    }
    return open(record, requestId, { kind: view.diff ? 'diff' : 'result', text, original: view.original });
}

export function initializePrivacyViews() {
    browser.runtime.onMessage.addListener((message, sender) => {
        if (!['privacyView.data', 'privacyView.submit'].includes(message?.action)) return;
        return Promise.resolve().then(() => {
            if (sender.id !== browser.runtime.id || sender.url?.split('?')[0] !== pageURL) throw cancelled();
            const page = pages.get(message.id);
            if (!page || page.record.disposed) throw cancelled();
            if (message.action === 'privacyView.data') return { ok: true, ...page.data };
            if (page.data.kind !== 'input' || !Array.isArray(message.values) ||
                message.values.length !== page.data.fields.length || message.values.some(value => typeof value !== 'string')) {
                throw viewError('INVALID_REQUEST', 'privacy_invalid_request');
            }
            pages.delete(message.id);
            page.resolve(message.values);
            return { ok: true };
        }).catch(error => ({ ok: false, error: error.message }));
    });
    browser.windows.onRemoved.addListener(windowId => {
        for (const [id, page] of pages) if (page.windowId === windowId) {
            pages.delete(id);
            page.reject?.(cancelled());
        }
    });
}
