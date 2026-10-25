/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { getPrivacyModelOptions, getPrivacyModelSize, disposePrivacyModelManager, PRIVACY_MODEL } from '../js/mztap-privacy-filter.js';

const formatBytes = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const msg = key => browser.i18n.getMessage(key);

// Two steps: (1) the model, downloaded by the background so it survives closing this
// page and can also be started from ThunderAI; (2) the switch, which mirrors ThunderAI's
// "Use ThunderAI Privacy" option and can be turned on only once the model is ready.
export async function initPrivacyOptions() {
    document.getElementById('privacy_model').textContent = PRIVACY_MODEL;
    const toggle = document.getElementById('privacy_filter_enabled');
    const download = document.getElementById('privacy_download');
    const refresh = document.getElementById('privacy_refresh');
    const remove = document.getElementById('privacy_delete');
    const size = document.getElementById('privacy_size');
    const status = document.getElementById('privacy_status');
    const progress = document.getElementById('privacy_progress');
    const backend = document.getElementById('privacy_backend');
    const log = document.getElementById('do_debug');
    const diagnostics = document.getElementById('privacy_diagnostics');
    const stepModel = document.getElementById('privacy_step_model');
    const stepEnable = document.getElementById('privacy_step_enable');
    const enableNote = document.getElementById('privacy_enable_note');
    const deleteNote = document.getElementById('privacy_delete_note');
    const updateDiagnostics = () => {
        if (log.checked) diagnostics.open = true;
    };
    updateDiagnostics();
    log.addEventListener('change', updateDiagnostics);
    let model = { ready: false, downloading: false, progress: null, loaded: null, total: null, error: null };
    let busy = false;
    let supported = false;
    let arch = '';
    let mainAvailable = false;
    let locked = false;
    // The outcome of the last action on this page, shown until the next one.
    let notice = null;
    const settings = async (action, data = {}) => {
        const result = await browser.runtime.sendMessage({ action, ...data });
        if (!result?.ok) throw new Error(result?.error?.message || msg('privacy_main_unavailable'));
        return result;
    };
    const setStatus = (text, state) => {
        status.textContent = text;
        status.dataset.state = state;
    };
    function render() {
        // Step 1: the model.
        download.disabled = busy || model.ready || model.downloading || !supported;
        refresh.disabled = busy || !supported;
        // A model in use goes only once the protection is off (the background refuses too).
        remove.disabled = busy || !model.ready || model.downloading || toggle.checked;
        deleteNote.hidden = !(model.ready && toggle.checked);
        progress.hidden = !model.downloading;
        if (Number.isFinite(model.progress)) progress.value = model.progress;
        else progress.removeAttribute('value');
        if (!supported) setStatus(msg('privacy_platform_unsupported'), 'error');
        else if (model.downloading) {
            setStatus(Number.isFinite(model.total) ?
                `${model.progress}% · ${formatBytes(model.loaded)} / ${formatBytes(model.total)}` : msg('privacy_downloading'), 'loading');
        } else if (notice) setStatus(notice.text, notice.state);
        else if (model.error) setStatus(model.error, 'error');
        else if (model.ready) setStatus(msg(toggle.checked ? 'privacy_enabled' : 'privacy_downloaded'), 'ready');
        else setStatus(msg('privacy_download_required'), 'missing');
        // Step 2: the switch. On without its model it can still be turned OFF.
        toggle.disabled = busy || !mainAvailable || locked || (!toggle.checked && !model.ready);
        const reason = !mainAvailable ? 'privacy_main_unavailable' : locked ? 'privacy_locked' :
            (!toggle.checked && !model.ready) ? 'privacy_enable_needs_model' : null;
        enableNote.hidden = !reason;
        enableNote.textContent = reason ? msg(reason) : '';
        stepModel.dataset.state = model.ready ? 'done' : 'current';
        stepEnable.dataset.state = !model.ready && !toggle.checked ? 'blocked' : toggle.checked ? 'done' : 'current';
        log.disabled = busy;
    }
    browser.runtime.onMessage.addListener(message => {
        if (message?.action === 'privacyState.changed' && !busy) {
            toggle.checked = message.enabled;
            locked = message.locked;
            render();
        } else if (message?.action === 'privacyModel.changed') {
            const finished = model.downloading && !message.downloading && message.ready;
            model = message;
            notice = null;
            render();
            // Download done: the next step is the switch.
            if (finished && !toggle.disabled) toggle.focus();
        }
    });
    async function readState() {
        const state = await settings('privacy.getState');
        toggle.checked = state.enabled;
        mainAvailable = state.main_available;
        locked = state.locked;
        log.checked = state.do_debug;
        supported = state.supported;
        arch = state.arch;
        model = state.model;
        updateDiagnostics();
        render();
    }
    // Every action: busy while it runs, its error kept as the notice.
    async function act(fn) {
        busy = true;
        notice = null;
        render();
        try { await fn(); }
        catch (error) { notice = { text: error.message, state: 'error' }; }
        finally { busy = false; render(); }
    }
    toggle.addEventListener('change', () => {
        const wanted = toggle.checked;
        return act(async () => {
            try {
                const result = await settings('privacy.setEnabled', { enabled: wanted });
                toggle.checked = result.enabled;
                locked = result.locked;
            } catch (error) {
                toggle.checked = !wanted;
                throw error;
            }
        });
    });
    log.addEventListener('change', () => act(async () => {
        try { await settings('privacy.setDebug', { enabled: log.checked }); }
        catch (error) { log.checked = !log.checked; throw error; }
        finally { updateDiagnostics(); }
    }));
    remove.addEventListener('click', () => {
        if (!window.confirm(msg('privacy_delete_confirm'))) return;
        return act(async () => {
            disposePrivacyModelManager();
            await settings('privacy.deleteModel', { confirmed: true });
            await readState();
            notice = { text: msg('privacy_deleted'), state: 'missing' };
        });
    });
    refresh.addEventListener('click', () => act(async () => {
        size.textContent = formatBytes(await getPrivacyModelSize());
        await readState();
    }));
    download.addEventListener('click', () => act(async () => {
        const result = await settings('privacy.download');
        model = result.model;
        if (size.textContent === msg('privacy_size_unknown')) {
            getPrivacyModelSize().then(bytes => { size.textContent = formatBytes(bytes); }, () => {});
        }
    }));
    render();
    try {
        await readState();
        if (!supported) {
            backend.textContent = arch;
            return;
        }
        const options = await getPrivacyModelOptions();
        backend.textContent = msg(options.device === 'webgpu' ? 'privacy_backend_webgpu' : 'privacy_backend_wasm');
        // The size matters before downloading; afterwards, "Check status" asks the Hub.
        if (!model.ready && !model.downloading) size.textContent = formatBytes(await getPrivacyModelSize());
    } catch (error) {
        notice = { text: error.message, state: 'error' };
        render();
    }
}
