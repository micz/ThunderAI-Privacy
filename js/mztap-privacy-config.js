/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
export const PRIVACY_MODEL = 'onnx-community/nym-pii-multilingual-ONNX';
export const PRIVACY_MODEL_REVISION = '7ce7f1a4dfc55a8037c3ae539b538fee2d44e5f0';
export const PRIVACY_TASK = 'token-classification';
// Required host permissions (manifest `permissions`), so the background can download
// without a user gesture: from ThunderAI's button or its autodownload policy.
export const PRIVACY_MODEL_ORIGINS = ['https://huggingface.co/*', 'https://*.hf.co/*'];
