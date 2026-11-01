
// OFFLINE PROPOSAL ONLY. No I/O, credentials, caller integration or live replay.
// Contract: canonical six-key helper JSONL, in the ordered phase slots supplied
// by the caller. Command/config/credential echo is NOT a safe-event channel.
// Only SGR (ESC[ numeric/semicolon parameters m, including ESC[m) is ignored.
// Cursor/erase/private/intermediate CSI and all other controls fail closed.
// A future PTY integration must resolve its echo contract in separate review.
const MAX_PHASE_BYTES = 64 * 1024;
const MAX_PHASE_EVENTS = 32;
const MAX_CSI_BYTES = 128;
const LABELS = new Set(['', 'canary', 'a', 'b']);
const ROUTES = new Set([
  'ready', 'closed', 'deadline', 'configure', 'operator_gate', 'login',
  'denied_login', 'me', 'organizations', 'own_today', 'foreign_today',
  'own_calendar', 'foreign_calendar', 'provider_connections',
]);
const CONTROLS = new Set(['ready', 'closed', 'deadline', 'configure', 'operator_gate']);
const UUID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;
// Fixed key order is the existing helper's wire contract. This anchored grammar
// rejects duplicate/extra/escaped keys, nested objects and prefix/suffix echo.
const RECORD = /^\s*\{\s*"label"\s*:\s*"(?:|canary|a|b)"\s*,\s*"route"\s*:\s*"[a-z_]+"\s*,\s*"status"\s*:\s*(?:0|[1-5][0-9]{2})\s*,\s*"request_id"\s*:\s*"[0-9a-f-]*"\s*,\s*"verified"\s*:\s*(?:true|false)\s*,\s*"denied"\s*:\s*(?:true|false)\s*\}\s*$/;

class SafeEventsError extends Error {
  constructor(code) {
    super(`Safe event readout rejected (${code}).`);
    this.name = 'SafeEventsError';
    this.code = code;
    // Never attach a chunk, line, parsed input, cause or debug dump.
  }
}

class SafeEventReadout {
  #expected = [];
  #events = [];
  #line = '';
  #bytes = 0;
  #ansi = 'normal';
  #ansiBytes = 0;
  #cr = false;
  #closed = false;

  constructor(expected) {
    if (!Array.isArray(expected) || !expected.length || expected.length > MAX_PHASE_EVENTS) {
      throw new SafeEventsError('INVALID_EXPECTATIONS');
    }
    const seen = new Set();
    for (const slot of expected) {
      if (!slot || Object.getPrototypeOf(slot) !== Object.prototype ||
          Object.keys(slot).sort().join(',') !== 'label,route' ||
          !LABELS.has(slot.label) || !ROUTES.has(slot.route) ||
          CONTROLS.has(slot.route) !== (slot.label === '')) {
        throw new SafeEventsError('INVALID_EXPECTATIONS');
      }
      const identity = `${slot.label}:${slot.route}`;
      if (seen.has(identity)) throw new SafeEventsError('AMBIGUOUS_EXPECTATIONS');
      seen.add(identity);
      this.#expected.push(Object.freeze({ label: slot.label, route: slot.route }));
    }
  }

  #reject(code) {
    this.clear();
    throw new SafeEventsError(code);
  }

  #ansiByte(char, code) {
    if (++this.#ansiBytes > MAX_CSI_BYTES) this.#reject('ANSI_OVERFLOW');
    if (this.#ansi === 'escape') {
      if (char !== '[') this.#reject('UNSUPPORTED_ANSI');
      this.#ansi = 'parameters';
    } else if (char === 'm') {
      this.#ansi = 'normal';
      this.#ansiBytes = 0;
    } else if ((code >= 0x30 && code <= 0x39) || char === ';') {
      // SGR parameters only. No terminal editing or cursor interpretation.
    } else {
      this.#reject('UNSUPPORTED_ANSI');
    }
  }

  #record() {
    const line = this.#line;
    this.#line = ''; // Do not retain already-consumed raw records.
    if (!line.trim()) return;
    if (!RECORD.test(line)) this.#reject('INVALID_RECORD');
    let event;
    try { event = JSON.parse(line); } catch { this.#reject('INVALID_RECORD'); }
    if (!ROUTES.has(event.route) || !UUID.test(event.request_id)) this.#reject('INVALID_RECORD');
    if (CONTROLS.has(event.route)) {
      const terminal = event.route === 'closed' || event.route === 'deadline';
      if (event.label !== '' || event.status !== 0 || event.denied || event.verified === terminal) {
        this.#reject('INVALID_RECORD');
      }
    } else {
      if (event.label === '' || event.status < 100) this.#reject('INVALID_RECORD');
      if (event.route === 'login') {
        if (event.denied || (event.verified && event.status !== 200)) {
          this.#reject('INVALID_RECORD');
        }
      } else if (event.route === 'denied_login') {
        if (event.verified !== event.denied ||
            (event.verified && ![400, 401, 403].includes(event.status))) {
          this.#reject('INVALID_RECORD');
        }
      } else {
        // GET denial uses 401/403 only; 400 is specific to Auth's banned login.
        const alwaysDeny = event.route.startsWith('foreign_') ||
          (event.route === 'provider_connections' && event.label === 'b');
        if ((event.denied && (!event.verified || ![401, 403].includes(event.status))) ||
            (event.verified && !event.denied && (event.status !== 200 || alwaysDeny))) {
          this.#reject('INVALID_RECORD');
        }
      }
    }
    const slot = this.#expected[this.#events.length];
    if (!slot || slot.label !== event.label || slot.route !== event.route) {
      this.#reject('UNEXPECTED_EVENT');
    }
    this.#events.push(Object.freeze(event));
  }

  feed(chunk) {
    if (this.#closed) throw new SafeEventsError('PHASE_CLOSED');
    if (typeof chunk !== 'string') this.#reject('INVALID_CHUNK');
    // The helper's entire safe protocol is ASCII. A phase has a cumulative
    // 64-KiB ingress ceiling, including ANSI/noise, not merely a tail ceiling.
    // This bounds pending text, staged events, and formatting work together.
    if (chunk.length > MAX_PHASE_BYTES - this.#bytes) this.#reject('OVERFLOW');
    this.#bytes += chunk.length;
    for (const char of chunk) {
      const code = char.charCodeAt(0);
      if (code > 0x7e || (code < 0x20 && ![9, 10, 13, 27].includes(code))) {
        this.#reject('UNSUPPORTED_CHARACTER');
      }
      if (this.#ansi !== 'normal') { this.#ansiByte(char, code); continue; }
      if (this.#cr) {
        if (char !== '\n') this.#reject('BARE_CR');
        this.#cr = false;
        this.#record();
      } else if (char === '\x1b') {
        this.#ansi = 'escape';
        this.#ansiBytes = 1;
      } else if (char === '\r') {
        this.#cr = true;
      } else if (char === '\n') {
        this.#record();
      } else {
        this.#line += char;
      }
    }
    // Only a count leaves an unfinished phase. Events are committed atomically
    // by finish(); a later malformed line cannot leave partial accepted output.
    return this.#events.length;
  }

  get ready() {
    return !this.#closed && this.#events.length === this.#expected.length &&
      !this.#line.trim() && !this.#cr && this.#ansi === 'normal';
  }

  finish() {
    if (this.#closed) throw new SafeEventsError('PHASE_CLOSED');
    if (this.#line.trim() || this.#cr || this.#ansi !== 'normal') {
      this.#reject('INCOMPLETE_FRAME');
    }
    if (this.#events.length !== this.#expected.length) this.#reject('INCOMPLETE_PHASE');
    const events = Object.freeze(this.#events.slice());
    this.clear();
    return events;
  }

  clear() {
    // Explicit phase abort/end; logical references only. JS cannot promise
    // physical heap zeroization. No raw-data inspection/serialization API exists.
    this.#expected = [];
    this.#events = [];
    this.#line = '';
    this.#bytes = 0;
    this.#ansi = 'normal';
    this.#ansiBytes = 0;
    this.#cr = false;
    this.#closed = true;
  }
}

export { MAX_PHASE_BYTES, MAX_PHASE_EVENTS, SafeEventReadout, SafeEventsError };
