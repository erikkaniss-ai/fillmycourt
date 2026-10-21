// QA-PREVIEW-02 historical live runner retired: no production or preview traffic.
// Retain this entry point as an explicit refusal, not a success-shaped no-op.
console.error("QA_PREVIEW_02_RETIRED: use getacourt/qa/preflight-cli.mjs locally. Hosted checks require a separate exact-scoped GO.");
process.exitCode=2;
