/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
import { downloadPrivacyModel, getPrivacyModelOptions, getPrivacyModelSize, isPrivacyModelDownloaded, disposePrivacyModelManager, PRIVACY_MODEL } from '../js/mztap-privacy-filter.js';

const formatBytes = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

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
    const updateDiagnostics = () => {
        if (log.checked) diagnostics.open = true;
    };
    updateDiagnostics();
    log.addEventListener('change', updateDiagnostics);
    const setStatus = (text, state) => {
        status.textContent = text;
        status.dataset.state = state;
    };
    let downloaded = false;
    let busy = false;
    let supported = false;
    const settings = async (action, data = {}) => {
        const result = await browser.runtime.sendMessage({ action, ...data });
        if (!result?.ok) throw new Error(result?.error?.message || browser.i18n.getMessage('privacy_main_unavailable'));
        return result;
    };
    const update = () => {
        // A local opt-in without its model can still be turned OFF.
        toggle.disabled = busy || (!toggle.checked && !downloaded);
        download.disabled = busy || downloaded || !supported;
        refresh.disabled = busy || !supported;
        remove.disabled = busy || !downloaded;
        log.disabled = busy;
    };
    async function checkCache() {
        const state = await settings('privacy.getState');
        toggle.checked = state.privacy_filter_enabled;
        log.checked = state.do_debug;
        updateDiagnostics();
        supported = state.supported;
        if (!supported) {
            downloaded = false;
            backend.textContent = state.arch;
            setStatus(browser.i18n.getMessage('privacy_platform_unsupported'), 'error');
            update();
            return;
        }
        const options = await getPrivacyModelOptions();
        backend.textContent = browser.i18n.getMessage(options.device === 'webgpu' ? 'privacy_backend_webgpu' : 'privacy_backend_wasm');
        downloaded = await isPrivacyModelDownloaded();
        setStatus(browser.i18n.getMessage(downloaded ? (toggle.checked ? 'privacy_enabled' : 'privacy_downloaded') : 'privacy_download_required'),
            downloaded ? 'ready' : 'missing');
        // Missing files block processing, never implicitly deactivate protection.
        update();
    }
    toggle.addEventListener('change', async () => {
        const previous = !toggle.checked;
        busy = true; update();
        try {
            if (toggle.checked && !await isPrivacyModelDownloaded()) throw new Error(browser.i18n.getMessage('privacy_download_required'));
            await settings('privacy.setEnabled', { enabled: toggle.checked });
            setStatus(browser.i18n.getMessage(toggle.checked ? 'privacy_enabled' :
                (downloaded ? 'privacy_downloaded' : 'privacy_download_required')), downloaded ? 'ready' : 'missing');
        } catch (error) {
            toggle.checked = previous;
            setStatus(error.message, 'error');
        } finally { busy = false; update(); }
    });
    log.addEventListener('change', async () => {
        busy = true; update();
        try { await settings('privacy.setDebug', { enabled: log.checked }); }
        catch (error) { log.checked = !log.checked; setStatus(error.message, 'error'); }
        finally { busy = false; update(); }
        updateDiagnostics();
    });
    remove.addEventListener('click', async () => {
        if (!window.confirm(browser.i18n.getMessage('privacy_delete_confirm'))) return;
        busy = true; update();
        try {
            disposePrivacyModelManager();
            await settings('privacy.deleteModel', { confirmed: true });
            await checkCache();
            setStatus(browser.i18n.getMessage('privacy_deleted'), 'missing');
        } catch (error) { setStatus(error.message, 'error'); }
        finally { busy = false; update(); }
    });
    refresh.addEventListener('click', async () => {
        const permission = browser.permissions.request({ origins: ['https://huggingface.co/*', 'https://*.hf.co/*'] });
        busy = true;
        update();
        try {
            if (!await permission) throw new Error(browser.i18n.getMessage('privacy_permission_required'));
            size.textContent = formatBytes(await getPrivacyModelSize());
            await checkCache();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally { busy = false; update(); }
    });
    download.addEventListener('click', async () => {
        // Must be requested directly from the user gesture (before any await).
        const permission = browser.permissions.request({ origins: ['https://huggingface.co/*', 'https://*.hf.co/*'] });
        busy = true;
        update();
        progress.hidden = false;
        progress.removeAttribute('value');
        try {
            if (!await permission) throw new Error(browser.i18n.getMessage('privacy_permission_required'));
            size.textContent = formatBytes(await getPrivacyModelSize());
            await downloadPrivacyModel(event => {
                if (event.status !== 'progress_total') return;
                progress.value = event.progress;
                setStatus(`${event.progress.toFixed(1)}% · ${formatBytes(event.loaded)} / ${formatBytes(event.total)}`, 'loading');
            });
            await checkCache();
        } catch (error) {
            setStatus(error.message, 'error');
        } finally {
            busy = false;
            progress.hidden = true;
            update();
        }
    });
    update();
    try {
        await checkCache();
        // Avoid unsolicited Hub traffic before the user grants model access.
        if (supported && await browser.permissions.contains({ origins: ['https://huggingface.co/*', 'https://*.hf.co/*'] })) {
            size.textContent = formatBytes(await getPrivacyModelSize());
        }
    } catch (error) { setStatus(error.message, 'error'); }
}
