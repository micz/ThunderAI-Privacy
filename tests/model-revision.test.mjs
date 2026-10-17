/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as config from '../js/mztap-privacy-config.js';

async function synthetic(context, exports) {
    const module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
    await module.link(() => {}); await module.evaluate();
    return module;
}

test('the actual runtime wrapper locks URLs as well as model revision options', async () => {
    const context = vm.createContext({ URL });
    const fetched = [];
    const env = { remoteHost: 'https://huggingface.co/', fetch: async url => { fetched.push(url); return 'fetched'; },
        backends: { onnx: { wasm: {} } } };
    const bundle = await synthetic(context, { env });
    const constants = await synthetic(context, config);
    const url = new URL('../js/mztap-transformers-runtime.js', import.meta.url);
    const module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context,
        initializeImportMeta(meta) { meta.url = url.href; },
        importModuleDynamically: () => bundle
    });
    await module.link(() => constants); await module.evaluate();
    await module.namespace.loadTransformersRuntime();
    assert.equal(env.remotePathTemplate, `{model}/resolve/${config.PRIVACY_MODEL_REVISION}/`);
    assert.equal(env.allowLocalModels, true);
    assert.equal(env.allowRemoteModels, false);
    assert.equal(env.useFS, false);
    const pinned = `${env.remoteHost}${config.PRIVACY_MODEL}/resolve/${config.PRIVACY_MODEL_REVISION}/config.json`;
    assert.throws(() => env.fetch(pinned), /blocked/);
    env.allowRemoteModels = true;
    assert.throws(() => env.fetch('/models/config.json'), /blocked/);
    assert.throws(() => env.fetch(pinned.replace(config.PRIVACY_MODEL_REVISION, 'main')), /blocked/);
    assert.throws(() => env.fetch(pinned.replace('config.json', '../config.json')), /blocked/);
    assert.equal(await env.fetch(pinned), 'fetched');
    assert.deepEqual(fetched, [pinned]);
});

async function workerHarness({ mainOnly = false } = {}) {
    const calls = [], urls = [], pipelines = [];
    const controls = {};
    const env = { allowRemoteModels: false, remoteHost: 'https://huggingface.co/', cacheKey: 'test', backends: { onnx: { wasm: {} } } };
    let nextId = 0;
    const pending = new Map();
    const context = vm.createContext({ self: {}, caches: { open: async () => ({ match: async url => {
        urls.push(url);
        return mainOnly ? url.includes('/resolve/main/') : url.includes(`/resolve/${config.PRIVACY_MODEL_REVISION}/`);
    } }) }, postMessage(message) {
        if (!message.event) {
            pending.get(message.id)(message); pending.delete(message.id);
        }
    } });
    const runtime = await synthetic(context, {
        supportsWebGpuFp16: async () => false,
        loadTransformersRuntime: async () => ({
            env,
            ModelRegistry: {
                async is_pipeline_cached(task, model, options) { assert.equal(env.allowRemoteModels, false); calls.push({ operation: 'cached', options }); return true; },
                async get_pipeline_files(task, model, options) { assert.equal(env.allowRemoteModels, true); calls.push({ operation: 'files', options }); return ['config.json']; },
                async get_file_metadata(model, file, options) {
                    if (controls.failMetadata) throw new Error('Metadata failed');
                    calls.push({ operation: 'metadata', options }); return { exists: true, size: 42 };
                }
            },
            async pipeline(task, model, options) {
                assert.equal(env.allowRemoteModels, !options.local_files_only);
                if (controls.failDownload) throw new Error('Download failed');
                pipelines.push(options);
                return { dispose: async () => {} };
            }
        })
    });
    const constants = await synthetic(context, config);
    const redaction = await synthetic(context, { createRedactionSession: getClassifier => ({
        async mask(text) { await getClassifier(); return { text }; }, getMappings: () => []
    }) });
    const module = new vm.SourceTextModule(await readFile(new URL('../js/workers/mztap-inference-worker.js', import.meta.url), 'utf8'), { context });
    await module.link(specifier => specifier.includes('runtime') ? runtime : specifier.includes('config') ? constants : redaction);
    await module.evaluate();
    return { calls, urls, pipelines, env, controls, request(command, fields = {}) {
        const id = ++nextId;
        return new Promise(resolve => {
            pending.set(id, resolve);
            context.self.onmessage({ data: { id, command, ...fields } });
        });
    } };
}

test('cache presence, size metadata, download and inference all use the immutable revision', async () => {
    const h = await workerHarness();
    assert.equal((await h.request('cached')).result, true);
    assert.equal((await h.request('size')).result, 42);
    assert.equal((await h.request('download')).result, true);
    assert.equal(h.env.allowRemoteModels, false);
    await h.request('createSession', { sessionId: 'session' });
    await h.request('mask', { sessionId: 'session', maskId: 'mask', text: 'hello' });
    for (const call of h.calls) assert.equal(call.options.revision, config.PRIVACY_MODEL_REVISION);
    for (const url of h.urls) assert.ok(url.includes(`/resolve/${config.PRIVACY_MODEL_REVISION}/`));
    assert.equal(h.pipelines.length, 2);
    for (const options of h.pipelines) assert.equal(options.revision, config.PRIVACY_MODEL_REVISION);
    assert.equal(h.pipelines[1].local_files_only, true, 'inference cannot implicitly download missing artifacts');
});

test('old floating-main cache entries cannot satisfy the pinned model guard', async () => {
    const h = await workerHarness({ mainOnly: true });
    assert.equal((await h.request('cached')).result, false);
    assert.equal(h.calls.length, 0);
    await h.request('createSession', { sessionId: 'session' });
    const result = await h.request('mask', { sessionId: 'session', maskId: 'mask', text: 'hello' });
    assert.equal(result.error.code, 'privacy_download_required');
    assert.equal(h.pipelines.length, 0);
});

test('failed size/download operations restore the offline guard before any later work', async () => {
    const h = await workerHarness();
    h.controls.failMetadata = true;
    assert.match((await h.request('size')).error.message, /Metadata failed/);
    assert.equal(h.env.allowRemoteModels, false);
    h.controls.failDownload = true;
    assert.match((await h.request('download')).error.message, /Download failed/);
    assert.equal(h.env.allowRemoteModels, false);
    assert.equal((await h.request('cached')).result, true);
});

test('real vendored runtime accepts cache-only configuration loads and rejects cache misses offline', async () => {
    // Exercise the actual 4.3.1 loader, not the worker mock: this catches its
    // source-configuration validation before it even consults the cache.
    const bundle = await import('../js/lib/transformers/transformers.min.js');
    // Node selects its native backend; supply only the browser WASM settings
    // object expected by our wrapper. No ONNX session or weights are loaded.
    bundle.env.backends.onnx.wasm ??= {};
    const { loadTransformersRuntime } = await import('../js/mztap-transformers-runtime.js');
    const { env, AutoConfig, ModelRegistry } = await loadTransformersRuntime();
    const saved = { useBrowserCache: env.useBrowserCache, useFSCache: env.useFSCache,
        useCustomCache: env.useCustomCache, customCache: env.customCache };
    const configURL = `${env.remoteHost}${config.PRIVACY_MODEL}/resolve/${config.PRIVACY_MODEL_REVISION}/config.json`;
    let present = true;
    const matches = [];
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.useCustomCache = true;
    env.customCache = {
        async match(url) {
            matches.push(url);
            if (present && url === configURL) return new Response(JSON.stringify({ model_type: 'modernbert' }));
            if (present && url.startsWith(configURL.slice(0, -'config.json'.length))) {
                return new Response('{}', { headers: { 'content-length': '2' } });
            }
        },
        async put() { throw new Error('Cache-only loading must not download/cache anything'); }
    };
    try {
        const options = { revision: config.PRIVACY_MODEL_REVISION, local_files_only: true };
        const loaded = await AutoConfig.from_pretrained(config.PRIVACY_MODEL, options);
        assert.equal(loaded.model_type, 'modernbert');
        assert.ok(matches.includes(configURL));
        assert.equal(await ModelRegistry.is_pipeline_cached(config.PRIVACY_TASK, config.PRIVACY_MODEL,
            { ...options, dtype: 'fp16', device: 'wasm' }), true);
        present = false;
        assert.equal(await ModelRegistry.is_pipeline_cached(config.PRIVACY_TASK, config.PRIVACY_MODEL,
            { ...options, dtype: 'fp16', device: 'wasm' }), false);
        await assert.rejects(AutoConfig.from_pretrained(config.PRIVACY_MODEL, options), /not found locally/);
        assert.equal(env.allowRemoteModels, false);
    } finally {
        Object.assign(env, saved);
    }
});
