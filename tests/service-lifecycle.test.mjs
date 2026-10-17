/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceHarness, deferred, until, turn, TOKEN } from './helpers/service.mjs';

const output = { content: TOKEN, thinking: '' };
const after = (h, requestId, context, fields = {}) => h.call('after', { requestId, context, output, format: 'text', ...fields });

for (const enabled of [false, true]) {
    test(`settings serialize; a failed enable cannot undo a later disable (initially enabled: ${enabled})`, async () => {
        const h = await serviceHarness({ enabled });
        const gate = deferred();
        h.controls.register = message => message.enabled ? gate.promise : { ok: true, protocol: 1 };
        const enabling = h.settings({ action: 'privacy.setEnabled', enabled: true });
        await until(() => h.registrations.length === 2);
        const disabling = h.settings({ action: 'privacy.setEnabled', enabled: false });
        const state = h.settings({ action: 'privacy.getState' });
        let discovered = false;
        const discovery = h.call('hello').then(result => { discovered = true; return result; });
        await turn();
        assert.equal(h.registrations.length, 2, 'disable must wait for enable/rollback');
        assert.equal(discovered, false, 'hello cannot see the provisional activation');
        gate.reject(new Error('Main unavailable'));
        assert.equal((await enabling).ok, false);
        assert.equal((await disabling).ok, true);
        assert.equal((await state).privacy_filter_enabled, false);
        assert.equal((await discovery).enabled, false);
        assert.equal(h.local.privacy_filter_enabled, false);
    });
}

test('concurrent successful enable/disable/enable changes commit in arrival order', async () => {
    const h = await serviceHarness({ enabled: false });
    const gate = deferred();
    h.controls.register = message => h.registrations.length === 2 ? gate.promise : { ok: true, protocol: 1 };
    const first = h.settings({ action: 'privacy.setEnabled', enabled: true });
    await until(() => h.registrations.length === 2);
    const second = h.settings({ action: 'privacy.setEnabled', enabled: false });
    const third = h.settings({ action: 'privacy.setEnabled', enabled: true });
    gate.resolve({ ok: true, protocol: 1 });
    for (const operation of [first, second, third]) assert.equal((await operation).ok, true);
    assert.deepEqual(h.registrations.map(message => message.enabled), [false, true, false, true]);
    assert.equal((await h.call('hello')).enabled, true);
    assert.equal(h.local.privacy_filter_enabled, true);
});

test('failed persistence does not change activation/debug or poison the settings queue', async () => {
    const h = await serviceHarness({ enabled: false });
    h.controls.write = async () => { throw new Error('Storage unavailable'); };
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: true })).ok, false);
    assert.equal((await h.settings({ action: 'privacy.setDebug', enabled: true })).ok, false);
    assert.equal((await h.call('hello')).enabled, false);
    assert.equal((await h.settings({ action: 'privacy.getState' })).do_debug, false);
    delete h.controls.write;
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: true })).ok, true);
    assert.equal((await h.call('hello')).enabled, true);
});

test('disable remains explicit even when the main add-on cannot acknowledge it', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'old' });
    h.controls.register = async () => { throw new Error('Main unavailable'); };
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: false })).ok, true);
    assert.equal((await h.call('hello')).enabled, false);
    assert.equal(h.local.privacy_filter_enabled, false);
    assert.equal((await after(h, 'old', prepared.context)).output.content, 'Alice', 'existing sessions still restore');
    assert.equal((await h.call('createSession', { sessionId: 'new' })).ok, false);
});

test('model deletion disposes sessions immediately, serializes enable and gates new sessions', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'old' });
    const gate = deferred();
    h.controls.deleteModel = () => gate.promise;
    const deleting = h.settings({ action: 'privacy.deleteModel', confirmed: true });
    await until(() => h.engines[0].disposed);
    const enabling = h.settings({ action: 'privacy.setEnabled', enabled: true });
    let created = false;
    const creating = h.call('createSession', { sessionId: 'new' }).then(result => { created = true; return result; });
    assert.equal((await after(h, 'old', prepared.context)).error.code, 'SESSION_EXPIRED');
    await turn();
    assert.equal(created, false);
    gate.resolve();
    assert.equal((await deleting).ok, true);
    assert.equal((await enabling).error.code, 'MODEL_NOT_READY');
    assert.equal((await creating).ok, true, 'session creation is lazy; missing model blocks its first mask');
    assert.equal((await h.before({ sessionId: 'new' })).error.code, 'MODEL_NOT_READY');
    assert.equal((await h.call('hello')).enabled, true, 'deletion never silently deactivates protection');
});

test('failed model deletion releases its guard and settings queue', async () => {
    const h = await serviceHarness();
    h.controls.deleteModel = async () => { throw new Error('Cache error'); };
    assert.equal((await h.settings({ action: 'privacy.deleteModel', confirmed: true })).ok, false);
    await h.create();
    assert.equal((await h.before()).ok, true);
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: false })).ok, true);
});

test('only the latest context is retained; repeated previews work and mappings survive retirement', async () => {
    const h = await serviceHarness();
    await h.create();
    let previous;
    for (let index = 0; index < 100; ++index) {
        const requestId = `request-${index}`;
        const prepared = await h.before({ requestId });
        assert.equal(prepared.ok, true);
        assert.deepEqual(h.counts(), [{ contexts: 1, pending: 0 }]);
        if (previous) assert.equal((await after(h, previous.requestId, previous.context)).error.code, 'SESSION_EXPIRED');
        for (let repeat = 0; repeat < 2; ++repeat) {
            assert.equal((await after(h, requestId, prepared.context)).output.content, 'Alice');
        }
        previous = { requestId, context: prepared.context };
    }
    assert.equal(h.engines.length, 1, 'context rotation must not recreate the mapping session');
    await h.call('disposeSession');
    assert.deepEqual(h.counts(), []);
    assert.equal(h.engines[0].disposed, true);
});

test('failed replacement preparation retires the old context without losing the conversation session', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'old' });
    h.controls.mask = async () => { throw new Error('Inference error'); };
    assert.equal((await h.before({ requestId: 'new' })).ok, false);
    assert.equal((await after(h, 'old', prepared.context)).error.code, 'SESSION_EXPIRED');
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }]);
    delete h.controls.mask;
    assert.equal((await h.before()).ok, true);
    assert.equal(h.engines.length, 1);
});

test('active and queued cancellation suppress late results and retire all call tombstones', async () => {
    const h = await serviceHarness();
    await h.create();
    const gate = deferred();
    let masks = 0;
    h.controls.mask = async () => { ++masks; return gate.promise; };
    const active = h.before({ callId: 'active-call', requestId: 'active' });
    await until(() => masks === 1);
    const queued = h.before({ callId: 'queued-call', requestId: 'queued' });
    await until(() => h.counts()[0].pending === 2);
    await h.call('cancel', { callId: 'queued-call', requestId: 'queued' });
    assert.equal(h.engines[0].cancellations, 0, 'cancelling queued work must not cancel its active peer');
    await h.call('cancel', { callId: 'active-call', requestId: 'active' });
    assert.equal(h.engines[0].cancellations, 1);
    gate.resolve({ text: TOKEN });
    assert.equal((await active).error.code, 'CANCELLED');
    assert.equal((await queued).error.code, 'CANCELLED');
    assert.equal(masks, 1);
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }]);
    for (let index = 0; index < 100; ++index) {
        await h.call('cancel', { callId: `unknown-${index}`, requestId: 'unknown' });
    }
    assert.deepEqual(h.counts(), [{ contexts: 0, pending: 0 }], 'late/unknown cancellation retains nothing');
    delete h.controls.mask;
    assert.equal((await h.before()).ok, true);
});

test('cancellation must match both call and request IDs; duplicate in-flight call IDs are rejected', async () => {
    const h = await serviceHarness();
    await h.create();
    const gate = deferred();
    let started = false;
    h.controls.mask = () => { started = true; return gate.promise; };
    const active = h.before({ callId: 'call', requestId: 'request' });
    await until(() => started);
    assert.equal((await h.before({ callId: 'call', requestId: 'other' })).error.code, 'INVALID_REQUEST');
    await h.call('cancel', { callId: 'call', requestId: 'wrong' });
    assert.equal(h.engines[0].cancellations, 0);
    gate.resolve({ text: TOKEN });
    assert.equal((await active).ok, true);
    assert.deepEqual(h.counts(), [{ contexts: 1, pending: 0 }]);
});

test('disposing during inference drops late output and releases session bookkeeping', async () => {
    const h = await serviceHarness();
    await h.create();
    const gate = deferred();
    let started = false;
    h.controls.mask = () => { started = true; return gate.promise; };
    const active = h.before();
    await until(() => started);
    assert.equal((await h.call('disposeSession')).ok, true);
    gate.resolve({ text: TOKEN });
    assert.equal((await active).error.code, 'SESSION_EXPIRED');
    assert.equal(h.engines[0].disposed, true);
    assert.deepEqual(h.counts(), []);
});

test('settings work does not delay cancellation of an existing session hook', async () => {
    const h = await serviceHarness();
    await h.create();
    const mask = deferred(), registration = deferred();
    let started = false;
    h.controls.mask = () => { started = true; return mask.promise; };
    const active = h.before({ callId: 'mask', requestId: 'request' });
    await until(() => started);
    h.controls.register = () => registration.promise;
    const disabling = h.settings({ action: 'privacy.setEnabled', enabled: false });
    await until(() => h.registrations.length === 2);
    await h.call('cancel', { callId: 'mask', requestId: 'request' });
    assert.equal(h.engines[0].cancellations, 1);
    mask.resolve({ text: TOKEN });
    assert.equal((await active).error.code, 'CANCELLED');
    registration.resolve({ ok: true, protocol: 1 });
    assert.equal((await disabling).ok, true);
});
