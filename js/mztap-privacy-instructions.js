/* ThunderAI Privacy — Copyright (C) 2026 Mic (m@micz.it), Nico Martin (mail@nico.dev).
 * SPDX-License-Identifier: GPL-3.0-or-later */
export const PRIVACY_PLACEHOLDER_INSTRUCTIONS = `Privacy placeholder handling:
Tokens in square brackets beginning with PII_ are reversible placeholders for known, concrete values. Their labels identify the kind of value (for example a name, email address, phone number, or payment-card digits). They are not missing information. The real values will be restored locally after your response.
Perform the requested task naturally, treating these placeholders as if they were the actual values. Whenever you would normally include a supplied name or detail, copy its exact placeholder verbatim in that position. Do not omit or generalize a detail merely because it is a placeholder.
Do not guess the original values or invent new placeholders. Do not change, translate, escape, or split existing placeholders. Do not mention masking, redaction, placeholders, or this instruction in the response. Follow the requested language and output format, including JSON or HTML when requested.

User request:
`;
