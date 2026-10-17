/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
// Pure redaction logic, separate from model loading so it can be tested offline.
// A session owns its mappings: never persist these or send them to an API worker.
const EMAIL = /(?:"(?:[^"\\\r\n]|\\.)+"|[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+)@(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?/gu;
const NUMERIC_CONTACT = /(?<![\p{L}\p{N}])(?:\+|00)?\d(?:[\d \t().-]*\d)?(?:[ \t]*(?:ext\.?|x|Durchwahl)[ \t]*\d+)?(?![\p{L}\p{N}])/giu;
const CARD_ENDING = /\b(?:card|(?:credit|debit|payment)\s+card|(?:Kredit|Debit|Bank)karte)\b[^\n.!?]{0,80}?\b(?:ends?\s+(?:in|with)|ending\s+(?:in|with)|last\s+(?:four|4)\s+digits?\s*(?:are|is|:)?|endet\s+(?:auf|mit))\s*[:#]?\s*(\d{4})\b/giu;
const BILLING_LAST_FOUR = /\b(?:last\s+(?:four|4)\s+digits?\s+(?:of\s+)?(?:the\s+)?(?:payment\s+|credit\s+|debit\s+)?card|(?:die\s+)?letzten\s+(?:vier|4)\s+Ziffern\s+(?:der\s+)?(?:Kredit|Debit|Bank)karte)\s*(?:are|is|sind|:|=)?\s*(\d{4})\b/giu;
const SIGNATURE_COMPANY = /(?:^|\n)[ \t>]*(?:customer\s+support|billing|support|kundenservice|kundensupport|buchhaltung)[ \t]*\|[ \t]*([^\n|<>]+)/giu;
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CASE_SENSITIVE_REPEATS = new Set([
    'GIVEN_NAME', 'SURNAME', 'COMPANY_NAME', 'CITY', 'STREET_ADDRESS',
    'STREET_NAME', 'SECONDARY_ADDRESS', 'API_KEY', 'PASSWORD', 'USERNAME',
]);
const IDENTIFIER_REPEATS = new Set([
    'EMAIL', 'PHONE', 'FAX_NUMBER', 'ACCOUNT_NUMBER', 'CREDIT_DEBIT_CARD',
    'CUSTOMER_ID', 'DRIVERS_LICENSE', 'EMPLOYEE_ID', 'GOVERNMENT_ID', 'IBAN',
    'LICENSE_PLATE', 'MAC_ADDRESS', 'MEDICAL_RECORD_NUMBER', 'PASSPORT', 'PIN',
    'ROUTING_NUMBER', 'SSN', 'SWIFT_BIC', 'TAX_ID',
]);

function repetitionFlags(label, value) {
    if ([...value].length < 3 || (/^\d+$/u.test(value) && value.length < 4)) return null;
    // Dates, ages, times and genders are contextual, not reusable identifiers.
    // Exact casing keeps a name like Will from masking the ordinary word will.
    if (CASE_SENSITIVE_REPEATS.has(label)) return 'gu';
    return IDENTIFIER_REPEATS.has(label) ? 'giu' : null;
}

function deterministicSpans(text) {
    const spans = [];
    const add = (start, end, label) => spans.push({ start, end, label, priority: 3 });
    for (const match of text.matchAll(EMAIL)) add(match.index, match.index + match[0].length, 'EMAIL');
    for (const match of text.matchAll(NUMERIC_CONTACT)) {
        const number = match[0];
        const digits = number.replace(/\D/g, '');
        const preceding = text.slice(Math.max(0, match.index - 40), match.index);
        const phoneContext = /(?:phone|mobile|telephone|tel\.?|telefon|mobil|fax)(?:\s*(?:number|nummer))?\s*(?:is|ist|:|=)?\s*$/iu.test(preceding);
        const formatted = /^(?:\+|00)/.test(number) || /[().-]/.test(number);
        const date = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(number);
        if (digits.length >= 7 && digits.length <= 15 && (phoneContext || formatted) && !date) {
            add(match.index, match.index + number.length, 'PHONE');
        }
        // Full card numbers: Luhn-valid sequences, or an explicit card label.
        if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits)) {
            let sum = 0;
            for (let index = digits.length - 1, double = false; index >= 0; --index, double = !double) {
                let digit = Number(digits[index]);
                if (double) { digit *= 2; if (digit > 9) digit -= 9; }
                sum += digit;
            }
            if (sum % 10 === 0 || /(?:card|karte)\s*(?:number|nummer)?\s*[:=]?\s*$/iu.test(preceding)) {
                add(match.index, match.index + number.length, 'CREDIT_DEBIT_CARD');
            }
        }
    }
    for (const expression of [CARD_ENDING, BILLING_LAST_FOUR, SIGNATURE_COMPANY]) {
        for (const match of text.matchAll(expression)) {
            const value = match[1].trim();
            const start = match.index + match[0].lastIndexOf(value);
            add(start, start + value.length, expression === SIGNATURE_COMPANY ? 'COMPANY_NAME' : 'CREDIT_DEBIT_CARD');
        }
    }
    return spans;
}

const yieldToWorker = () => new Promise(resolve => setTimeout(resolve, 0));

// Bound every inference by its actual re-encoded size, including special tokens.
// Character offsets are Unicode-scalar boundaries, never halves of a surrogate.
async function planChunks(tokenizer, text, limit, checkCancelled) {
    const offsets = [0];
    for (const char of text) offsets.push(offsets.at(-1) + char.length);
    const chunks = [];
    const overlap = Math.min(limit - 1, Math.max(tokenizer.encode('').length + 1, Math.min(128, Math.floor(limit / 4))));
    let start = 0;
    while (start < offsets.length - 1) {
        checkCancelled();
        let low = start + 1, high = Math.min(offsets.length - 1, start + limit * 8);
        let end = start, ids;
        while (low <= high) {
            const candidate = Math.floor((low + high) / 2);
            const encoded = tokenizer.encode(text.slice(offsets[start], offsets[candidate]));
            if (encoded.length <= limit) { end = candidate; ids = encoded; low = candidate + 1; }
            else high = candidate - 1;
        }
        if (end === start) throw new Error('Privacy filter: cannot safely split input.');
        chunks.push({ text: text.slice(offsets[start], offsets[end]), start: offsets[start], ids });
        if (end === offsets.length - 1) break;
        low = start + 1;
        high = end - 1;
        let next = end;
        while (low <= high) {
            const candidate = Math.floor((low + high) / 2);
            if (tokenizer.encode(text.slice(offsets[candidate], offsets[end])).length <= overlap) {
                next = candidate;
                high = candidate - 1;
            } else low = candidate + 1;
        }
        if (next === end) throw new Error('Privacy filter: cannot safely overlap input chunks.');
        start = next;
        await yieldToWorker();
    }
    return chunks;
}

async function classifyChunk(classifier, chunk) {
    const { ids } = chunk;
    const decode = end => classifier.tokenizer.decode(ids.slice(0, end), { skip_special_tokens: true });
    const normalized = decode(ids.length);
    // Some tokenizers trim edge whitespace on independently encoded windows.
    // Permit only that known offset shift; never guess an internal alignment.
    if (normalized.trim() !== chunk.text.trim()) throw new Error('Privacy filter: cannot safely align chunk text.');
    const shift = chunk.text.match(/^\s*/)[0].length - normalized.match(/^\s*/)[0].length;
    const spans = [];
    for (const token of await classifier(chunk.text)) {
        if (token.entity === 'O') continue;
        const label = token.entity.replace(/^[BI]-/, '');
        if (!/^[A-Z0-9_]+$/.test(label) || !Number.isInteger(token.index) || token.index < 0 || token.index >= ids.length) {
            throw new Error('Privacy filter: invalid entity boundaries.');
        }
        const previous = spans.at(-1);
        if (token.entity.startsWith('I-') && previous?.label === label && previous.end === token.index) {
            previous.end = token.index + 1;
        } else {
            if (previous && previous.end > token.index) throw new Error('Privacy filter: overlapping entities.');
            spans.push({ label, start: token.index, end: token.index + 1 });
        }
    }
    return spans.flatMap(({ label, start, end }) => {
        const before = decode(start), through = decode(end);
        if (!normalized.startsWith(before) || !normalized.startsWith(through) || through.length < before.length) {
            throw new Error('Privacy filter: cannot safely align token boundaries.');
        }
        // NER can label isolated whitespace or a special token with no visible
        // text. Neither represents a value to mask. Keep rejecting invalid
        // prefixes/backwards spans; only discard safely aligned empty content.
        if (through.length === before.length) return [];
        const raw = normalized.slice(before.length, through.length);
        const value = raw.trim();
        if (!value) return [];
        const localStart = before.length + raw.match(/^\s*/)[0].length + shift;
        const localEnd = localStart + value.length;
        if (localStart < 0 || localEnd > chunk.text.length || chunk.text.slice(localStart, localEnd) !== value) {
            throw new Error('Privacy filter: cannot safely align chunk boundaries.');
        }
        return [{ label, start: chunk.start + localStart, end: chunk.start + localEnd, priority: 2 }];
    });
}

export function createRedactionSession(getClassifier, nonce = crypto.randomUUID().slice(0, 8)) {
    const values = new Map();
    const entities = new Map();
    const counts = new Map();
    const knownValues = new Map();
    const prefix = `PII_${nonce}_`;
    const pattern = new RegExp(`\\[${prefix}[A-Z0-9_]+\\]`, 'g');
    const restore = text => text.replace(pattern, placeholder => values.get(placeholder) ?? placeholder);

    async function mask(text, { onProgress = () => {}, isCancelled = () => false } = {}) {
        const checkCancelled = () => {
            if (isCancelled()) {
                const error = new Error('Privacy filtering cancelled');
                error.code = 'privacy_cancelled';
                throw error;
            }
        };
        checkCancelled();
        if (typeof text !== 'string') throw new TypeError('Privacy filter expects text.');
        // Prevent user text from impersonating a placeholder owned by this session.
        if (text.includes(prefix)) throw new Error('Input contains a reserved privacy placeholder.');
        // The reply window represents line breaks as <br>. Feed real text to NER,
        // but NEVER strip arbitrary <...> content: it can contain email addresses.
        text = text.replace(/<br\s*\/?>/gi, '\n');
        if (!text.trim()) return { text, restore };
        const classifier = await getClassifier();
        checkCancelled();
        const ids = classifier.tokenizer.encode(text);
        const limit = Math.min(2048, classifier.tokenizer.model_max_length ?? 2048,
            classifier.model.config.max_position_embeddings ?? 2048);
        if (!Number.isInteger(limit) || limit < 4) throw new Error('Privacy filter: invalid model token limit.');
        const decoded = classifier.tokenizer.decode(ids, { skip_special_tokens: true });
        // Preserve original edge whitespace when tokenization only trims it.
        // Internal normalization still uses one full-input canonical text.
        const normalized = decoded.trim() === text.trim() ? text : decoded;
        const normalizedIds = classifier.tokenizer.encode(normalized);
        const chunks = normalizedIds.length <= limit ? [{ text: normalized, ids: normalizedIds, start: 0 }] :
            await planChunks(classifier.tokenizer, normalized, limit, checkCancelled);
        const detected = [];
        for (const [index, chunk] of chunks.entries()) {
            checkCancelled();
            onProgress({ current: index + 1, total: chunks.length });
            checkCancelled();
            detected.push(...await classifyChunk(classifier, chunk));
            // Let worker cancellation messages run before starting another chunk.
            await yieldToWorker();
            checkCancelled();
        }
        detected.push(...deterministicSpans(normalized));
        // Remember all detected values, including narrower model spans covered by
        // a full-email rule. This catches missed signatures and later follow-ups.
        for (const { label, start, end } of detected) {
            const value = normalized.slice(start, end);
            knownValues.set(JSON.stringify([label, value]), { label, value });
        }
        const candidates = [...detected];
        for (const { label, value } of knownValues.values()) {
            const flags = repetitionFlags(label, value);
            if (!flags) continue;
            for (const match of normalized.matchAll(new RegExp(escapeRegExp(value), flags))) {
                const start = match.index, end = start + match[0].length;
                // Unicode-aware boundaries prevent "Ann" masking "annual", and
                // keep an email's local part intact when a name matches it.
                if (/^[\p{L}\p{N}\p{M}_]/u.test(value) && /[\p{L}\p{N}\p{M}_]$/u.test(normalized.slice(0, start))) continue;
                if (/[\p{L}\p{N}\p{M}_]$/u.test(value) && /^[\p{L}\p{N}\p{M}_]/u.test(normalized.slice(end))) continue;
                candidates.push({ label, start, end, priority: 1 });
            }
        }
        // Take the union of overlapping spans: never let a partial model EMAIL
        // prediction defeat the full-email rule or create nested placeholders.
        candidates.sort((a, b) => a.start - b.start || b.end - a.end || b.priority - a.priority);
        const merged = [];
        for (const candidate of candidates) {
            const previous = merged.at(-1);
            if (previous && candidate.start < previous.end) {
                if (candidate.end > previous.end) {
                    previous.end = candidate.end;
                    if (previous.label !== candidate.label) previous.label = 'PII';
                }
            } else {
                merged.push({ ...candidate });
            }
        }
        const replacements = merged.map(({ label, start, end }) => {
            const value = normalized.slice(start, end);
            const key = JSON.stringify([label, value]);
            let placeholder = entities.get(key);
            if (!placeholder) {
                const number = (counts.get(label) ?? 0) + 1;
                counts.set(label, number);
                placeholder = `[${prefix}${label}_${number}]`;
                entities.set(key, placeholder);
                values.set(placeholder, value);
            }
            return { start, end, text: placeholder };
        });
        let masked = normalized;
        for (const replacement of replacements.reverse()) {
            masked = masked.slice(0, replacement.start) + replacement.text + masked.slice(replacement.end);
        }
        return { text: masked, restore };
    }
    return { mask, restore, getMappings: () => [...values] };
}
