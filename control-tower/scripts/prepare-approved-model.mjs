import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateApprovedModel } from '../acceptance.mjs';
import { decodeModelEnvelope } from './model-envelope.mjs';

if (process.env.GITHUB_REPOSITORY !== 'erikkaniss-ai/fillmycourt' ||
    process.env.GITHUB_REF !== 'refs/heads/cto/development-control-tower' ||
    !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw Error('Isolated approved workflow required');
const raw = process.env.CONTROL_TOWER_APPROVED_MODEL;
if (!raw || /github_pat_|ghp_|access_token|refresh_token/.test(raw)) throw Error('Approved non-credential server data required');
const model = decodeModelEnvelope(raw);
if (!validateApprovedModel(model)) throw Error('Approved model invalid; deployment stopped');
model.releaseSha = process.env.GITHUB_SHA;
model.packagedBy = { workflowRun: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
const target = resolve('control-tower/config/approved-model.json');
const original = JSON.parse(await readFile(target, 'utf8'));
if (original.status !== 'NOT_CONFIGURED') throw Error('Expected data-free committed placeholder');
await writeFile(target, JSON.stringify(model));
// No private acceptance data or policy details are emitted into public CI logs.
console.log('Approved server-only acceptance bundle prepared (not a public asset).');
