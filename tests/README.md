# Companion contract checks

Run with Node.js 22+:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
```

These checks exercise JSON/placeholder restoration, extra-body and identifier
contracts, model-revision propagation and the actual service/view modules with
mocked extension APIs and inference/model management. Each service test gets an
isolated VM, preferences and session state. They cover settings ordering/rollback,
deletion, context retirement, cancellation, disposal and companion-owned windows.
The model-revision checks also exercise the actual vendored configuration/cache
loader with synthetic cached files, catching source-flag validation regressions
without fetching model files or creating an ONNX inference session.
Focused redaction regressions use a Unicode-scalar tokenizer and fixed predictions
to exercise chunking/alignment, rule/partial-span interactions, repetition and
literal markup preservation. These are deterministic correctness checks, not the
removed detector-quality corpus. They do not download a tokenizer or model weights.

## Optional real-tokenizer check

Place `tokenizer.json` and `tokenizer_config.json` from the immutable revision in
`VENDORS_INFO.md` in the same local directory, then run:

```sh
PRIVACY_TOKENIZER_PATH=/path/to/tokenizer.json node --experimental-vm-modules --test tests/*.test.mjs
```

`real-tokenizer.test.mjs` verifies both fixture hashes before loading the vendored
tokenizer. It exercises real whitespace/Unicode alignment and overlapping chunks
with fixed predictions, plus literal-special-token rejection. It is skipped when
the environment variable is unset. No network requests or model weights are used;
keep fixtures outside the repository or under a `*.local` directory.

Real Thunderbird cross-add-on messaging, window behavior, CPU/WebGPU execution
and detection quality still require manual verification with fictional data.
