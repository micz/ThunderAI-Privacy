/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
const id = new URLSearchParams(location.search).get('id');
const error = document.getElementById('error');
const form = document.getElementById('input');
const submit = document.getElementById('submit');
const message = key => browser.i18n.getMessage(key);

async function request(action, extra = {}) {
    const response = await browser.runtime.sendMessage({ action, id, ...extra });
    if (!response?.ok) throw new Error(response?.error || message('privacy_session_expired'));
    return response;
}

try {
    const data = await request('privacyView.data');
    document.getElementById('title').textContent = message(data.kind === 'input' ? 'privacy_web_input_title' : 'privacy_web_result_title');
    document.getElementById('description').textContent = message('privacy_web_local_notice');
    if (data.kind === 'input') {
        form.hidden = false;
        submit.textContent = message('privacy_web_continue');
        const fields = document.getElementById('fields');
        data.fields.forEach((field, index) => {
            const label = document.createElement('label');
            label.textContent = field.info || message('privacy_web_additional_text');
            const input = document.createElement('textarea');
            input.id = `field-${index}`;
            label.htmlFor = input.id;
            fields.append(label, input);
        });
        fields.querySelector('textarea')?.focus();
        form.addEventListener('submit', async event => {
            event.preventDefault();
            submit.disabled = true;
            try {
                await request('privacyView.submit', { values: [...fields.querySelectorAll('textarea')].map(input => input.value) });
                const win = await browser.windows.getCurrent();
                await browser.windows.remove(win.id);
            } catch (err) {
                error.textContent = err.message;
                submit.disabled = false;
            }
        });
    } else {
        const result = document.getElementById('result');
        result.hidden = false;
        if (data.kind === 'diff') {
            for (const part of globalThis.Diff.diffWords(data.original, data.text)) {
                const span = document.createElement('span');
                span.textContent = part.value;
                if (part.added) span.className = 'added';
                if (part.removed) span.className = 'removed';
                result.appendChild(span);
            }
        } else result.textContent = data.text;
    }
} catch (err) {
    error.textContent = err.message;
}
