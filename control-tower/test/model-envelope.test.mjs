import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeModelEnvelope } from '../scripts/model-envelope.mjs';
const envelope = raw => 'gzip:' + gzipSync(raw).toString('base64');

test('server acceptance envelope preserves exact JSON without logging private data', () => {
  const raw = JSON.stringify({ status: 'APPROVED', reason: 'Проверенные критерии', projects: [] });
  assert.deepEqual(decodeModelEnvelope(raw), JSON.parse(raw));
  assert.deepEqual(decodeModelEnvelope(envelope(raw)), JSON.parse(raw));
});
test('compressed approval data rejects credentials, malformed input and expansion bombs', () => {
  for (const raw of ['{"token":"github_pat_test"}', '{"refresh_token":"test"}'])
    assert.throws(() => decodeModelEnvelope(envelope(raw)), /Credentials/);
  for (const raw of ['', 'gzip:bad', '{', 'a'.repeat(65537), envelope('a'.repeat(262145))])
    assert.throws(() => decodeModelEnvelope(raw));
});
