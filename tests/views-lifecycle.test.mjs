/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceHarness, deferred, until, TOKEN } from './helpers/service.mjs';

test('closing an input window rejects the hook and retires its pending call', async () => {
    const h = await serviceHarness();
    await h.create();
    const input = h.call('collectInput', { requestId: 'input', fields: [{ info: 'Name' }] });
    await until(() => h.windows.length === 1);
    h.closeWindow(h.windows[0].id);
    assert.equal((await input).error.code, 'CANCELLED');
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }]);
    assert.equal((await h.before()).ok, true);
});

test('cancelling/disposal of an input form rejects the wait and closes its window', async () => {
    for (const dispose of [false, true]) {
        const h = await serviceHarness();
        await h.create();
        const input = h.call('collectInput', { callId: 'form', requestId: 'input', fields: [{ info: 'Name' }] });
        await until(() => h.windows.length === 1);
        if (dispose) await h.call('disposeSession');
        else await h.call('cancel', { callId: 'form', requestId: 'input' });
        assert.equal((await input).error.code, 'CANCELLED');
        await until(() => h.removed.includes(h.windows[0].id));
        assert.deepEqual(h.counts(), dispose ? [] : [{ contexts: 0, pending: 0 }]);
    }
});

test('late window creation after disposal closes the orphan window', async () => {
    const h = await serviceHarness();
    await h.create();
    const gate = deferred();
    h.controls.openWindow = () => gate.promise;
    const input = h.call('collectInput', { requestId: 'input', fields: [{ info: 'Name' }] });
    await until(() => h.windows.length === 1);
    await h.call('disposeSession');
    assert.equal((await input).ok, false);
    gate.resolve();
    await until(() => h.removed.includes(h.windows[0].id));
});

test('only the companion view can read/submit its data; submission releases the queue', async () => {
    const h = await serviceHarness();
    await h.create();
    const input = h.call('collectInput', { requestId: 'input', fields: [{ info: 'Name' }] });
    await until(() => h.windows.length === 1);
    const win = h.windows[0];
    assert.equal((await h.view('privacyView.data', win, {}, 'https://chatgpt.com/')).ok, false);
    assert.equal((await h.view('privacyView.data', win)).kind, 'input');
    assert.equal((await h.view('privacyView.submit', win, { values: [] })).ok, false);
    assert.equal((await h.view('privacyView.submit', win, { values: ['Alice'] })).ok, true);
    assert.deepEqual(Array.from((await input).values), ['Alice']);
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }]);
    assert.equal((await h.view('privacyView.data', win)).ok, false, 'submitted form data is retired');
});

test('restored previews can repeat for the latest context and are closed on model deletion', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    for (let count = 0; count < 2; ++count) {
        const result = await h.call('after', { requestId: 'request', context: prepared.context,
            output: { content: TOKEN, thinking: '' }, format: 'text', view: { original: 'Baseline', diff: !!count } });
        assert.equal(result.ok, true);
        const data = await h.view('privacyView.data', h.windows[count]);
        assert.equal(data.text, 'Alice');
        assert.equal(data.kind, count ? 'diff' : 'result');
    }
    h.main.enabled = false; // the model goes only with the protection off
    await h.settings({ action: 'privacy.deleteModel', confirmed: true });
    assert.deepEqual(h.removed, h.windows.map(win => win.id));
    assert.deepEqual(h.counts(), []);
});

test('cancelling a preview while its window opens revokes the context and suppresses late success', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'request' });
    const gate = deferred();
    h.controls.openWindow = () => gate.promise;
    const fields = { requestId: 'request', context: prepared.context,
        output: { content: TOKEN, thinking: '' }, format: 'text' };
    const preview = h.call('after', { ...fields, callId: 'preview', view: { original: '', diff: false } });
    await until(() => h.windows.length === 1);
    await h.call('cancel', { callId: 'preview', requestId: 'request' });
    gate.resolve();
    assert.equal((await preview).error.code, 'CANCELLED');
    await until(() => h.removed.includes(h.windows[0].id));
    assert.equal((await h.call('after', fields)).error.code, 'SESSION_EXPIRED');
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }]);
});
