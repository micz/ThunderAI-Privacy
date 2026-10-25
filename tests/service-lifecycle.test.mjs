/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceHarness, deferred, until, turn, TOKEN } from './helpers/service.mjs';

const output = { content: TOKEN, thinking: '' };
const after = (h, requestId, context, fields = {}) => h.call('after', { requestId, context, output, format: 'text', ...fields });

test('the switch mirrors ThunderAI: getState reads it, setEnabled writes it there and nothing locally', async () => {
    const h = await serviceHarness({ enabled: false });
    const state = await h.settings({ action: 'privacy.getState' });
    assert.deepEqual([state.enabled, state.locked, state.main_available], [false, false, true]);
    const enabled = await h.settings({ action: 'privacy.setEnabled', enabled: true });
    assert.deepEqual([enabled.ok, enabled.enabled, enabled.locked], [true, true, false]);
    assert.equal(h.main.enabled, true);
    assert.deepEqual(h.settingRequests.filter(m => m.action === 'aiProcessing.setSetting').map(m => [m.protocol, m.enabled]), [[1, true]]);
    assert.equal((await h.settings({ action: 'privacy.getState' })).enabled, true);
    assert.equal(Object.hasOwn(h.local, 'privacy_filter_enabled'), false);
    assert.equal(Object.hasOwn(await h.call('hello'), 'enabled'), false, 'activation is not part of the status');
});

test('enabling needs the model before ThunderAI is asked; disabling never does', async () => {
    const h = await serviceHarness({ enabled: true });
    h.controls.downloaded = false;
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: true })).error.code, 'MODEL_NOT_READY');
    assert.equal(h.settingRequests.length, 0);
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: false })).ok, true, 'a switch on without its model can still be turned off');
    assert.equal(h.main.enabled, false);
});

test('a policy lock in ThunderAI is reported and changes nothing', async () => {
    const h = await serviceHarness({ enabled: true });
    h.main.locked = true;
    assert.equal((await h.settings({ action: 'privacy.getState' })).locked, true);
    const refused = await h.settings({ action: 'privacy.setEnabled', enabled: false });
    assert.deepEqual([refused.ok, refused.error.code, refused.error.message], [false, 'ai_processing_setting_locked', 'Locked by policy']);
    assert.equal(h.main.enabled, true);
});

test('ThunderAI unreachable or incompatible: getState says so, setEnabled fails, nothing is assumed', async () => {
    const h = await serviceHarness({ enabled: true });
    h.main.available = false;
    const state = await h.settings({ action: 'privacy.getState' });
    assert.deepEqual([state.enabled, state.main_available], [false, false]);
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: false })).error.code, 'MAIN_UNAVAILABLE');
    h.main.available = true;
    h.controls.setting = () => ({ ok: true, protocol: 99 });
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: false })).error.code, 'PROTOCOL_UNSUPPORTED');
    assert.equal(h.main.enabled, true);
});

test('settingChanged from ThunderAI reaches the settings pages; malformed or foreign ones do not', async () => {
    const h = await serviceHarness();
    assert.equal((await h.external({ action: 'aiProcessing.settingChanged', protocol: 1, enabled: false, locked: true })).ok, true);
    const pageStates = () => JSON.parse(JSON.stringify(h.relayed.filter(m => m.action === 'privacyState.changed')));
    assert.deepEqual(pageStates(), [{ action: 'privacyState.changed', enabled: false, locked: true }]);
    for (const [message, sender] of [
        [{ action: 'aiProcessing.settingChanged', protocol: 1, enabled: 'no', locked: false }, undefined],
        [{ action: 'aiProcessing.settingChanged', protocol: 99, enabled: true, locked: false }, undefined],
        [{ action: 'aiProcessing.settingChanged', protocol: 1, enabled: true, locked: false }, { id: 'other@example.com' }],
    ]) assert.equal((await h.external(message, sender)).ok, false);
    assert.equal(pageStates().length, 1);
});

test('setting changes serialize in arrival order', async () => {
    const h = await serviceHarness({ enabled: false });
    const gate = deferred();
    h.controls.setting = message => message.enabled ? gate.promise : { ok: true, protocol: 1, enabled: false, locked: false };
    const enabling = h.settings({ action: 'privacy.setEnabled', enabled: true });
    await until(() => h.settingRequests.length === 1);
    const disabling = h.settings({ action: 'privacy.setEnabled', enabled: false });
    await turn();
    assert.equal(h.settingRequests.length, 1, 'disable waits for the enable');
    gate.resolve({ ok: true, protocol: 1, enabled: true, locked: false });
    assert.equal((await enabling).enabled, true);
    assert.equal((await disabling).enabled, false);
    assert.deepEqual(h.settingRequests.map(m => m.enabled), [true, false]);
});

test('failed debug persistence does not change it or poison the settings queue', async () => {
    const h = await serviceHarness({ enabled: false });
    h.controls.write = async () => { throw new Error('Storage unavailable'); };
    assert.equal((await h.settings({ action: 'privacy.setDebug', enabled: true })).ok, false);
    assert.equal((await h.settings({ action: 'privacy.getState' })).do_debug, false);
    delete h.controls.write;
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: true })).ok, true);
});

test('model deletion disposes sessions immediately, serializes enable and gates new sessions', async () => {
    const h = await serviceHarness();
    await h.create();
    const prepared = await h.before({ requestId: 'old' });
    h.main.enabled = false; // switched off after the session started
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
    assert.equal(h.main.enabled, false);
    assert.equal(h.readiness.at(-1).ready, false, 'ThunderAI learns the model is gone');
    assert.equal((await h.call('hello')).ready, false);
});

test('failed model deletion releases its guard and settings queue', async () => {
    const h = await serviceHarness({ enabled: false });
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
    h.controls.setting = () => registration.promise;
    const disabling = h.settings({ action: 'privacy.setEnabled', enabled: false });
    await until(() => h.settingRequests.length === 1);
    await h.call('cancel', { callId: 'mask', requestId: 'request' });
    assert.equal(h.engines[0].cancellations, 1);
    mask.resolve({ text: TOKEN });
    assert.equal((await active).error.code, 'CANCELLED');
    registration.resolve({ ok: true, protocol: 1, enabled: false, locked: false });
    assert.equal((await disabling).ok, true);
});

test('readiness: hello reports it, and startup announces it to ThunderAI and to the settings pages', async () => {
    const h = await serviceHarness();
    const hello = await h.call('hello');
    assert.deepEqual([hello.ready, hello.downloading], [true, false]);
    assert.deepEqual([h.readiness[0].protocol, h.readiness[0].ready, typeof h.readiness[0].instanceId], [1, true, 'string']);
    assert.ok(h.relayed.some(m => m.action === 'privacyModel.changed' && m.ready === true));
    const other = await serviceHarness({ enabled: false });
    assert.equal(other.readiness.length, 1, 'announced once at startup, ready or not: ThunderAI learns the companion started');
});

test('a download started from ThunderAI runs in the background, reports progress and makes the model ready', async () => {
    const h = await serviceHarness({ enabled: false });
    h.controls.downloaded = false;
    await h.settings({ action: 'privacy.deleteModel', confirmed: true });
    assert.equal((await h.call('hello')).ready, false);
    const gate = deferred();
    let report;
    h.controls.download = progress => { report = progress; return gate.promise; };
    const started = await h.external({ action: 'aiProcessing.downloadModel', protocol: 1 });
    assert.deepEqual([started.ok, started.downloading, started.ready], [true, true, false]);
    report({ status: 'progress_total', progress: 41.7, loaded: 41, total: 100 });
    report({ status: 'progress_total', progress: 41.9, loaded: 42, total: 100 }); // same percent: not re-sent
    assert.deepEqual(h.readiness.filter(m => m.downloading).map(m => m.progress), [0, 41]);
    assert.equal((await h.external({ action: 'aiProcessing.downloadModel', protocol: 1 })).downloading, true, 'a second request joins the running download');
    assert.equal((await h.settings({ action: 'privacy.deleteModel', confirmed: true })).error.code, 'MODEL_BUSY');
    gate.resolve();
    await until(() => h.readiness.at(-1).ready);
    assert.deepEqual([h.readiness.at(-1).downloading, (await h.call('hello')).ready], [false, true]);
    assert.equal((await h.settings({ action: 'privacy.setEnabled', enabled: true })).enabled, true);
});

test('a failed download reports its error; without the host permission it does not start', async () => {
    const h = await serviceHarness({ enabled: false });
    h.controls.downloaded = false;
    await h.settings({ action: 'privacy.deleteModel', confirmed: true });
    h.controls.download = async () => { throw new Error('network down'); };
    assert.equal((await h.settings({ action: 'privacy.download' })).ok, true);
    await until(() => h.readiness.at(-1).error);
    assert.deepEqual([h.readiness.at(-1).error, h.readiness.at(-1).ready], ['privacy_download_failed', false]);
    h.controls.permission = false;
    assert.equal((await h.external({ action: 'aiProcessing.downloadModel', protocol: 1 })).error.code, 'PERMISSION_REQUIRED');
});

test('the model cannot be deleted while ThunderAI\'s switch is on', async () => {
    const h = await serviceHarness({ enabled: true });
    const refused = await h.settings({ action: 'privacy.deleteModel', confirmed: true });
    assert.deepEqual([refused.ok, refused.error.code], [false, 'PRIVACY_ACTIVE']);
    assert.equal(h.controls.downloaded, true);
    h.main.available = false; // an unreachable ThunderAI does not hold it back
    assert.equal((await h.settings({ action: 'privacy.deleteModel', confirmed: true })).ok, true);
});

test('ThunderAI can open this add-on\'s settings page', async () => {
    const h = await serviceHarness();
    assert.equal((await h.external({ action: 'aiProcessing.openSettings', protocol: 1 })).ok, true);
    assert.equal(h.openedSettings.length, 1);
    assert.equal((await h.external({ action: 'aiProcessing.openSettings', protocol: 1 }, { id: 'other@example.com' })).ok, false);
    assert.equal(h.openedSettings.length, 1);
});

test('Check status rechecks the model cache, tells ThunderAI when it changed, and asks ThunderAI again', async () => {
    const h = await serviceHarness({ enabled: false });
    h.controls.downloaded = false; // evicted behind the cached readiness
    assert.equal((await h.settings({ action: 'privacy.getState' })).model.ready, true, 'getState alone keeps the cached value');
    const announced = h.readiness.length;
    h.main.available = false;
    const state = await h.settings({ action: 'privacy.refresh' });
    assert.deepEqual([state.ok, state.model.ready, state.main_available], [true, false, false]);
    assert.deepEqual(h.readiness.slice(announced).map(m => m.ready), [false]);
    assert.equal((await h.call('hello')).ready, false);
    h.main.available = true;
    h.controls.downloaded = true;
    const again = await h.settings({ action: 'privacy.refresh' });
    assert.deepEqual([again.model.ready, again.main_available], [true, true]);
    await h.settings({ action: 'privacy.refresh' });
    assert.deepEqual(h.readiness.slice(announced).map(m => m.ready), [false, true], 'no announcement when nothing changed');
});
