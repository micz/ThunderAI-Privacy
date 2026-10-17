/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// Internal worker only. Mappings never leave this add-on.
export class PrivacyClient {
    constructor(worker = new Worker(new URL('./workers/mztap-inference-worker.js', import.meta.url), { type: 'module' })) {
        this.worker = worker;
        this.pending = new Map();
        this.nextId = 0;
        this.onPageHide = () => this.close();
        if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide, { once: true });
        worker.onmessage = ({ data }) => {
            const pending = this.pending.get(data.id);
            if (!pending) return;
            if (data.event === 'progress') { pending.progress?.(data.info); return; }
            this.pending.delete(data.id);
            if (data.error != null) {
                const error = new Error(data.error.message);
                if (data.error.code) error.code = data.error.code;
                if (data.error.limit != null) error.limit = data.error.limit;
                pending.reject(error);
            } else pending.resolve(data.result);
        };
        worker.onerror = () => this.close(new Error('Local privacy worker failed'));
        worker.onmessageerror = () => this.close(new Error('Local privacy response could not be read'));
    }

    request(command, payload = {}, progress) {
        if (!this.worker) return Promise.reject(new Error('Local privacy worker is closed'));
        const id = ++this.nextId;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, progress });
            try { this.worker.postMessage({ id, command, ...payload }); }
            catch (error) { this.pending.delete(id); reject(error); }
        });
    }

    close(error = new Error('Local privacy worker was disposed')) {
        this.worker?.terminate();
        this.worker = null;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    }
}
