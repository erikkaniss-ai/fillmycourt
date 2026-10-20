import { gunzipSync } from 'node:zlib';

export function decodeModelEnvelope(value) {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 65536)
    throw Error('Bounded approved data required');
  const raw = value.startsWith('gzip:')
    ? gunzipSync(Buffer.from(value.slice(5), 'base64'), { maxOutputLength: 262144 }).toString('utf8')
    : value;
  if (/github_pat_|ghp_|access_token|refresh_token/.test(raw))
    throw Error('Credentials are not acceptance data');
  return JSON.parse(raw);
}
