'use strict';

// Credential-free offline fixtures only. No live data, replay, network or I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SafeEventReadout, SafeEventsError, MAX_PHASE_BYTES } from '../scripts/fill_uat_safe_events.mjs';
const ME = Object.freeze({ label: 'canary', route: 'me', status: 401,
  request_id: '00000000-0000-4000-8000-000000000001', verified: true, denied: true });
const LOGIN = Object.freeze({ label: 'canary', route: 'denied_login', status: 400,
  request_id: '', verified: true, denied: true });
const A = JSON.stringify(ME), B = JSON.stringify(LOGIN);
const expected = (...events) => events.map(({ label, route }) => ({ label, route }));
const parser = (...events) => new SafeEventReadout(expected(...events));
function collect(chunks, events = [ME]) {
  const p = parser(...events);
  for (const chunk of chunks) p.feed(chunk);
  return p.finish();
}
function rejects(fn, code, sentinel = 'SYNTHETIC-SENSITIVE-MARKER') {
  assert.throws(fn, error => {
    assert.ok(error instanceof SafeEventsError);
    assert.equal(error.code, code);
    assert.ok(!String(error).includes(sentinel));
    assert.ok(!JSON.stringify(error).includes(sentinel));
    assert.equal(error.cause, undefined);
    return true;
  });
}
// Faithful old per-read extraction, for the known valid fixture only.
function legacy(chunk) {
  const cleaned = chunk.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]/g, '');
  return [...cleaned.matchAll(/\{"label"\s*:\s*"[^"]*",\s*"route"\s*:\s*"[^"]*",\s*"status"\s*:\s*\d+,\s*"request_id"\s*:\s*"[^"]*",\s*"verified"\s*:\s*(?:true|false),\s*"denied"\s*:\s*(?:true|false)\}/g)];
}

test('whole record, blank whitespace and split CRLF', () => {
  assert.deepEqual(collect([A + '\n']), [ME]);
  assert.deepEqual(collect([' \t\n', A + '\r', '\n']), [ME]);
});

test('original 125 split boundaries: old loses all, new recovers all', () => {
  assert.equal(A.length - 1, 125);
  let lost = 0;
  for (let split = 1; split < A.length; split++) {
    const chunks = [A.slice(0, split), A.slice(split) + '\n'];
    if (chunks.flatMap(legacy).length === 0) lost++;
    assert.deepEqual(collect(chunks), [ME]);
  }
  assert.equal(lost, 125);
});

test('single-character reads retain only an unfinished record', () => {
  assert.deepEqual(collect([...(A + '\n')]), [ME]);
});

test('two fragmented post-ban records: old zero, new exactly two', () => {
  const chunks = [A.slice(0, 37), A.slice(37) + '\r\n' + B.slice(0, 51), B.slice(51) + '\n'];
  assert.equal(chunks.flatMap(legacy).length, 0);
  assert.deepEqual(collect(chunks, [ME, LOGIN]), [ME, LOGIN]);
});

test('every split of SGR-decorated record, including inside CSI', () => {
  const wire = '\x1b[0m' + A.replace('"status"', '\x1b[1;31m"status"\x1b[0m') + '\x1b[m\n';
  for (let split = 1; split < wire.length; split++) {
    assert.deepEqual(collect([wire.slice(0, split), wire.slice(split)]), [ME]);
  }
});

test('cursor, erase, private and intermediate CSI rejected at every split', () => {
  for (const control of ['\x1b[2J', '\x1b[K', '\x1b[1A', '\x1b[H', '\x1b[?25l', '\x1b[1 q']) {
    rejects(() => parser(ME).feed(control + A + '\n'), 'UNSUPPORTED_ANSI');
    for (let split = 1; split < control.length; split++) {
      rejects(() => {
        const p = parser(ME);
        p.feed(control.slice(0, split));
        p.feed(control.slice(split) + A + '\n');
      }, 'UNSUPPORTED_ANSI');
    }
    // Even a preceding valid event is not committed if terminal edits follow.
    const p = parser(ME);
    rejects(() => p.feed(A + '\n' + control), 'UNSUPPORTED_ANSI');
    rejects(() => p.finish(), 'PHASE_CLOSED');
  }
});

test('explicit clear aborts phase, releases staged output and is idempotent', () => {
  const p = parser(ME);
  p.feed(A + '\n');
  assert.equal(p.ready, true);
  p.clear(); p.clear();
  assert.equal(p.ready, false);
  rejects(() => p.finish(), 'PHASE_CLOSED');
  rejects(() => p.feed(''), 'PHASE_CLOSED');
  assert.deepEqual(collect([A + '\n']), [ME]);
});

test('events committed once and immutable; extra/replayed event closes phase', () => {
  const p = parser(ME);
  assert.equal(p.feed(A + '\n'), 1);
  assert.equal(p.feed(''), 1);
  const out = p.finish();
  assert.deepEqual(out, [ME]);
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out[0]));
  rejects(() => p.finish(), 'PHASE_CLOSED');
  const replay = parser(ME);
  rejects(() => replay.feed(A + '\n' + A + '\n'), 'UNEXPECTED_EVENT');
  rejects(() => replay.finish(), 'PHASE_CLOSED');
});

test('64-KiB ingress ceiling includes already consumed records and ANSI', () => {
  const p = parser(ME);
  p.feed(A + '\n');
  p.feed(' '.repeat(MAX_PHASE_BYTES - A.length - 1));
  assert.deepEqual(p.finish(), [ME]);
  const overflow = parser(ME);
  overflow.feed(A + '\n');
  rejects(() => overflow.feed(' '.repeat(MAX_PHASE_BYTES)), 'OVERFLOW');
  rejects(() => overflow.finish(), 'PHASE_CLOSED');
  rejects(() => parser(ME).feed('x'.repeat(MAX_PHASE_BYTES + 1)), 'OVERFLOW');
});

test('unknown schema, duplicate keys, escaped keys and invalid flags/status/ID rejected', () => {
  const invalid = [
    A.replace('"me"', '"unapproved_route"'),
    A.replace('"label":', '"extra":true,"label":'),
    A.replace('"label":', '"label":"a","label":'),
    A.replace('"label"', '"la\\u0062el"'),
    A.replace('"verified":true', '"verified":"true"'),
    A.replace('"status":401', '"status":42'),
    A.replace('"status":401', '"status":600'),
    A.replace('00000000-0000-4000-8000-000000000001', 'not-a-uuid'),
    A.replace('"denied":true', '"denied":true,"__proto__":{}'),
    A.replace('"verified":true', '"verified":false'),
  ];
  for (const wire of invalid) rejects(() => parser(ME).feed(wire + '\n'), 'INVALID_RECORD');
});

test('out-of-order/extra/mismatched phase identities rejected', () => {
  rejects(() => parser(ME, LOGIN).feed(B + '\n'), 'UNEXPECTED_EVENT');
  rejects(() => parser(ME).feed(A.replace('"canary"', '"a"') + '\n'), 'UNEXPECTED_EVENT');
  rejects(() => new SafeEventReadout(expected(ME, ME)), 'AMBIGUOUS_EXPECTATIONS');
  rejects(() => new SafeEventReadout([]), 'INVALID_EXPECTATIONS');
});

test('arbitrary sensitive echoes, nested events and suffix/prefix data rejected atomically', () => {
  const marker = 'SYNTHETIC-SENSITIVE-MARKER'; // Deliberately not a real credential.
  const echoes = [
    marker + A,
    A + marker,
    JSON.stringify({ op: 'configure', plan: { password: marker, nested: ME } }),
    JSON.stringify({ password: marker, event: ME }),
  ];
  for (const echo of echoes) {
    const p = parser(ME);
    rejects(() => p.feed(echo + '\n'), 'INVALID_RECORD', marker);
    rejects(() => p.finish(), 'PHASE_CLOSED', marker);
  }
  const laterEcho = parser(ME);
  rejects(() => laterEcho.feed(A + '\n' + marker + '\n'), 'INVALID_RECORD', marker);
  rejects(() => laterEcho.finish(), 'PHASE_CLOSED', marker);
});

test('incomplete line/ANSI/CR or missing events cannot finish a phase', () => {
  rejects(() => { const p = parser(ME); p.feed(A); p.finish(); }, 'INCOMPLETE_FRAME');
  rejects(() => { const p = parser(ME); p.feed('\x1b[31'); p.finish(); }, 'INCOMPLETE_FRAME');
  rejects(() => { const p = parser(ME); p.feed(A + '\r'); p.finish(); }, 'INCOMPLETE_FRAME');
  rejects(() => parser(ME).finish(), 'INCOMPLETE_PHASE');
});

test('unsupported controls, OSC, malformed/overlong ANSI and bare CR fail closed', () => {
  rejects(() => parser(ME).feed('\x1b]0;SYNTHETIC-SENSITIVE-MARKER\x07'), 'UNSUPPORTED_ANSI');
  rejects(() => parser(ME).feed('\x1b[ 1m'), 'UNSUPPORTED_ANSI');
  rejects(() => parser(ME).feed('\x1b[' + '1'.repeat(130)), 'ANSI_OVERFLOW');
  rejects(() => parser(ME).feed('x\rx'), 'BARE_CR');
  rejects(() => parser(ME).feed('\x00'), 'UNSUPPORTED_CHARACTER');
  rejects(() => parser(ME).feed('\u2603'), 'UNSUPPORTED_CHARACTER');
  rejects(() => parser(ME).feed({ secret: 'SYNTHETIC-SENSITIVE-MARKER' }), 'INVALID_CHUNK');
});

test('login accepts only verified 200, never a denial; false outcomes remain false', () => {
  const login = { ...ME, route: 'login', status: 200, denied: false };
  assert.deepEqual(collect([JSON.stringify(login) + '\n'], [login]), [login]);
  for (const bad of [
    { ...login, status: 400 }, { ...login, denied: true },
    { ...login, status: 403, denied: true },
  ]) rejects(() => parser(bad).feed(JSON.stringify(bad) + '\n'), 'INVALID_RECORD');
  for (const failure of [
    { ...login, verified: false }, { ...login, status: 401, verified: false },
  ]) assert.deepEqual(collect([JSON.stringify(failure) + '\n'], [failure]), [failure]);
});

test('denied_login verifies only banned-status denial; unverified outcomes never become PASS', () => {
  for (const status of [400, 401, 403]) {
    const denial = { ...LOGIN, status };
    assert.deepEqual(collect([JSON.stringify(denial) + '\n'], [denial]), [denial]);
  }
  for (const bad of [
    { ...LOGIN, status: 200, denied: false },
    { ...LOGIN, status: 401, denied: false },
    { ...LOGIN, status: 200 }, { ...LOGIN, verified: false },
  ]) rejects(() => parser(bad).feed(JSON.stringify(bad) + '\n'), 'INVALID_RECORD');
  for (const status of [200, 400, 401, 403, 429, 500]) {
    const failure = { ...LOGIN, status, verified: false, denied: false };
    assert.deepEqual(collect([JSON.stringify(failure) + '\n'], [failure]), [failure]);
  }
});

test('GET denies only 401/403; foreign/manager-only routes never report positive PASS', () => {
  rejects(() => parser(ME).feed(A.replace('"status":401', '"status":400') + '\n'), 'INVALID_RECORD');
  for (const status of [401, 403]) {
    const denial = { ...ME, status };
    assert.deepEqual(collect([JSON.stringify(denial) + '\n'], [denial]), [denial]);
  }
  for (const bad of [
    { ...ME, route: 'foreign_today', status: 200, denied: false },
    { ...ME, route: 'foreign_calendar', status: 200, denied: false },
    { ...ME, label: 'b', route: 'provider_connections', status: 200, denied: false },
  ]) rejects(() => parser(bad).feed(JSON.stringify(bad) + '\n'), 'INVALID_RECORD');
  const failedCheck = { ...ME, status: 200, verified: false, denied: false };
  assert.deepEqual(collect([JSON.stringify(failedCheck) + '\n'], [failedCheck]), [failedCheck]);
});

test('control events preserve the helper protocol; impossible statuses rejected', () => {
  const ready = { label: '', route: 'ready', status: 0, request_id: '', verified: true, denied: false };
  const closed = { ...ready, route: 'closed', verified: false };
  assert.deepEqual(collect([JSON.stringify(ready) + '\n'], [ready]), [ready]);
  assert.deepEqual(collect([JSON.stringify(closed) + '\n'], [closed]), [closed]);
  rejects(() => parser(ready).feed(JSON.stringify({ ...ready, verified: false }) + '\n'), 'INVALID_RECORD');
  rejects(() => parser(ME).feed(A.replace('"status":401', '"status":0') + '\n'), 'INVALID_RECORD');
  rejects(() => parser(ME).feed(A.replace('"status":401', '"status":200') + '\n'), 'INVALID_RECORD');
});
