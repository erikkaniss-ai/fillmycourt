import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {normalizePersonalObservation} from '../assets/personal-observation-bridge.mjs';
const require = createRequire(import.meta.url);
const validateObservation = require('../assets/personal-source-observation.js').validateObservation;
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Actual page/relay/worker/collector with controlled time and fictional DOM/API.
// Observation validation/normalization are production code. The finite catalog,
// capture, view and query helper are mocks. No real browser or provider traffic.
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(outputDirectory, '../..');
const sourcePaths = {
  page: 'getacourt/assets/court-search-page.mjs',
  background: 'getacourt/browser-companion/background.js',
  search: 'getacourt/browser-companion/search.js',
  relay: 'getacourt/browser-companion/get-page-relay.js'
};
const sources = {};
for (const [key, relative] of Object.entries(sourcePaths)) {
  sources[key] = await readFile(path.join(repository, relative), 'utf8');
}
const epoch = Date.parse('2026-11-04T08:00:00Z');
const receiver = 'https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html';
const query = {
  location: 'FICTIONAL CLUB', date: '2026-11-04', sport: 'padel',
  from: '08:00', to: '23:00', duration: '90'
};

class Clock {
  now = epoch;
  serial = 0;
  timers = new Map();
  setTimeout = (callback, delay = 0) => {
    const id = ++this.serial;
    this.timers.set(id, {id, at: this.now + Math.max(0, delay), callback});
    return id;
  };
  clearTimeout = id => this.timers.delete(id);
  async flush() {
    // Await-only browser mock chains need multiple microtask checkpoints.
    for (let count = 0; count < 100; count++) await Promise.resolve();
  }
  async advanceTo(elapsed) {
    const target = epoch + elapsed;
    assert.ok(target >= this.now, 'Clock cannot move backwards');
    await this.flush();
    for (;;) {
      const next = [...this.timers.values()]
        .filter(timer => timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.now = next.at;
      this.timers.delete(next.id);
      next.callback();
      await this.flush();
    }
    this.now = target;
    await this.flush();
  }
  elapsed() { return this.now - epoch; }
}

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return true;
  }
}

class Element extends Events {
  textContent = '';
  value = '';
  children = [];
  dataset = {};
  options = [];
  disabled = false;
  checked = false;
  classList = {toggle() {}, contains() { return false; }};
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  querySelector() { return new Element(); }
  getClientRects() { return [{}]; }
}

function chromeEvent() {
  const listeners = new Set();
  return {
    addListener: callback => listeners.add(callback),
    removeListener: callback => listeners.delete(callback),
    emit: (...args) => [...listeners].map(callback => callback(...args)),
    listeners
  };
}

function globals(clock) {
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  return {
    Date: ControlledDate, URL, Uint8Array, console,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    fetch() { throw Error('Network forbidden in this diagnostic'); },
    Event: class { constructor(type, details = {}) { this.type = type; Object.assign(this, details); } },
    CustomEvent: class { constructor(type, details = {}) { this.type = type; Object.assign(this, details); } }
  };
}

function fixtureObservation(clock, tab, providerQuery) {
  return {
    sourceUrl: tab.url, provider: 'playtomic', source: 'user_ui_observation',
    capturedAt: new Date(clock.now-(tab.plan.stale?60000:0)).toISOString(), date: providerQuery.date,
    sport: providerQuery.sport, timezone: null, sourceFreshness: 'unknown',
    coverage: 'expanded_offers_only', venue: 'FICTIONAL CLUB',
    offers: [{court: 'FICTIONAL COURT', startLabel: '8:00 AM',
      endLabel: '9:30 AM', durationMinutes: 90, priceEur: 36.5}]
  };
}

function createProviderContext(clock, tab, trace) {
  const messages = chromeEvent();
  const dateInput = new Element();
  dateInput.value = query.date;
  const sportInput = new Element();
  sportInput.value = 'padel';
  sportInput.options = [{value: 'padel', textContent: 'Padel'}];
  sportInput.selectedOptions = sportInput.options;
  const start = new Element();
  const startSummary = new Element();
  startSummary.innerText = '8:00 AM';
  start.querySelector = () => startSummary;
  const court = new Element();
  const courtSummary = new Element();
  courtSummary.innerText = 'FICTIONAL COURT';
  court.parentElement = {closest: () => null};
  court.querySelector = () => courtSummary;
  court.querySelectorAll = () => [start];
  const region = new Element();
  region.loading = false;
  Object.defineProperty(region, 'innerText', {get: () => region.loading ? 'Loading' : 'Available courts'});
  region.querySelector = selector => selector.includes('aria-busy')
    ? (region.loading ? {} : null) : dateInput;
  region.querySelectorAll = selector => {
    if (selector === 'input[type="date"]') return [dateInput];
    if (selector === 'select') return [sportInput];
    if (selector === 'details') return [court];
    return [];
  };
  const heading = new Element();
  heading.textContent = 'Available courts';
  heading.parentElement = region;
  heading.closest = () => region;
  let settleCount = 0;
  const context = vm.createContext({
    ...globals(clock), location: {href: tab.url}, innerWidth: 480,
    chrome: {runtime: {id: 'fictional-reader', onMessage: messages}},
    getComputedStyle: () => ({visibility: 'visible'}),
    HTMLSelectElement: class {}, HTMLInputElement: class {},
    document: {querySelectorAll: selector => selector === 'h2' ? [heading] : []},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() {
        const duration = (tab.plan.settles || [500, 500])[settleCount++];
        trace.push({event: 'settle-start', at: clock.elapsed(), tab: tab.id, duration});
        region.loading = duration > 500;
        if (Number.isFinite(duration) && duration > 500) {
          this.timer = clock.setTimeout(() => {
            region.loading = false;
            this.callback();
          }, duration - 500);
        }
      }
      disconnect() { clock.clearTimeout(this.timer); }
    },
    capturePlaytomic: () => fixtureObservation(clock, tab, tab.providerQuery)
  });
  vm.runInContext(sources.search, context, {filename: sourcePaths.search});
  return {context, messages};
}

async function setup(plans, options = {}) {
  const clock = new Clock();
  const trace = [];
  const controls = {};
  const requests = [];
  const pageWindow = new Events();
  pageWindow.top = pageWindow;
  pageWindow.addEventListener('gac:auto-search-request', event => requests.push(event.detail));
  const nodes = new Map();
  const byId = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const form = byId('search');
  form.elements = {namedItem: name => byId(name)};
  form.requestSubmit = () => form.dispatchEvent({type: 'submit', preventDefault() {}});
  const normalizerCalls = [];
  const renderCounts = [];
  let nonceByte = 16;
  const pageContext = vm.createContext({
    ...globals(clock), window: pageWindow,
    document: {getElementById: byId, createElement: () => new Element(),
      documentElement: new Element(), querySelector: () => new Element(),
      addEventListener() {}, hidden: false},
    FormData: class { [Symbol.iterator]() { return Object.entries(query)[Symbol.iterator](); } },
    crypto: {getRandomValues: bytes => bytes.fill(++nonceByte)},
    Option: class { constructor(text, value) { this.text = text; this.value = value; } }
  });
  const pageGlobals = {
    validateQuery: () => ({...query}), localDay: () => query.date,
    normalizePersonalObservation: (raw, expected, options) => {
      normalizerCalls.push({at: clock.elapsed()});
      return normalizePersonalObservation(raw, expected, {...options, validator: validateObservation});
    },
    createPlayerSearchView: () => ({
      render: rows => renderCounts.push({at: clock.elapsed(), count: rows.length}),
      renderEvents() {}, setMode() {}
    }),
    demoOffers: () => [], projectEvents() {}, projectEventSources() {}, eventDemoFixtures() {}
  };
  Object.assign(pageContext, pageGlobals);
  vm.runInContext(sources.page.replace(/^import .*;\r?\n/gm, ''), pageContext,
    {filename: sourcePaths.page});

  const tabs = new Map();
  const updated = chromeEvent();
  const backgroundMessages = chromeEvent();
  const local = {approvedSource: 'https://playtomic.com/clubs/fictional-club-1'};
  if (options.noApprovedSource) delete local.approvedSource;
  const session = options.session || {approvedTab: 77};
  const area = store => ({
    async get(key) { return {[key]: store[key]}; },
    async set(values) { Object.assign(store, values); },
    async remove(key) { delete store[key]; }
  });
  let nextTab = 100;
  let createdCount = 0;
  const chrome = {
    runtime: {id: 'fictional-reader', onMessage: backgroundMessages,
      getURL: file => `chrome-extension://fictional-reader/${file}`},
    storage: {local: area(local), session: area(session)},
    permissions: {async contains() { return !options.noSiteAccess; }},
    tabs: {
      onUpdated: updated,
      async create(tabOptions) {
        const plan = plans[createdCount++];
        assert.ok(plan, 'Unexpected provider tab attempt');
        if(options.deferCreate)await new Promise(resolve => {controls.resolveCreate=resolve;});
        const tab = {id: nextTab++, url: tabOptions.url, status: 'loading', plan};
        tabs.set(tab.id, tab);
        trace.push({event: 'tab-created', at: clock.elapsed(), tab: tab.id});
        clock.setTimeout(() => {
          if (!tabs.has(tab.id)) return;
          tab.status = 'complete';
          updated.emit(tab.id, {status: 'complete'});
        }, plan.load);
        return {...tab};
      },
      async get(id) {
        assert.ok(tabs.has(id), 'Unknown tab');
        return {...tabs.get(id)};
      },
      async remove(id) {
        assert.ok(tabs.has(id),'Cleanup must target a tab created by this operation');
        tabs.delete(id);trace.push({event: 'tab-removed', at: clock.elapsed(), tab: id});
      },
      async sendMessage(id, message) {
        trace.push({event: 'cancel-delivery', at: clock.elapsed(), tab: id});
        tabs.get(id)?.provider?.messages.emit(message, {id: 'fictional-reader'});
      }
    },
    windows: {
      async create(windowOptions) {
        assert.ok(tabs.has(windowOptions.tabId),'Only an owned created tab may enter the temporary window');
        if(options.deferWindow)await new Promise(resolve => {controls.resolveWindow=resolve;});
        trace.push({event: 'window-created', at: clock.elapsed()}); return {id: 900};
      },
      async remove(id) {
        assert.equal(id,900,'Cleanup may only remove the operation-created window');
        trace.push({event: 'window-remove-attempt', at: clock.elapsed()});
        if(options.removeFails)throw Error('Fictional cleanup failure');
        trace.push({event: 'window-removed', at: clock.elapsed()}); tabs.clear();
      }
    },
    scripting: {
      async executeScript({target, files, func, args}) {
        trace.push({event: 'script-requested', at: clock.elapsed(), files: Boolean(files)});
        const tab = tabs.get(target.tabId);
        assert.ok(tab, 'Unknown fictional injection target');
        if (files) {
          assert.deepEqual(Array.from(files), ['capture.js', 'search.js']);
          tab.provider = createProviderContext(clock, tab, trace);
          return [];
        }
        if (options.pendingInjection) return new Promise(resolve => {
          controls.resolveCapture=() => resolve([{frameId:0,result:{readerError:'SEARCH_DEADLINE'}}]);
        });
        tab.providerQuery = args[0];
        const injected = vm.runInContext(`(${func.toString()})`, tab.provider.context);
        const result = await injected(...args);
        trace.push({event: 'search-returned', at: clock.elapsed(), tab: tab.id,
          error: result.readerError || null});
        return [{frameId: 0, result}];
      }
    }
  };
  const background = vm.createContext({
    ...globals(clock), chrome,
    importScripts(...files) { trace.push({event: 'mocked-imports', files}); },
    GetACourtPersonalSourceObservation: {validateObservation},
    GetACourtPlaytomicClubCatalog: {matching: () => plans.map((_, index) => ({
      sourceUrl: `https://playtomic.com/clubs/fictional-club-${index + 1}`
    }))}
  });
  vm.runInContext(sources.background, background, {filename: sourcePaths.background});
  const responses = [];
  const send = (message, popup = false, senderChanges = {}) => new Promise(resolve => {
    const sender = {id: 'fictional-reader', frameId: 0,
      url: popup ? chrome.runtime.getURL('popup.html') : receiver,
      ...(popup ? {} : {tab: {id: 1}}), ...senderChanges};
    backgroundMessages.emit(message, sender, result => {
      responses.push({at: clock.elapsed(), action: message.action, result});
      trace.push({event: 'runtime-response', at: clock.elapsed(), action: message.action});
      resolve(result);
    });
  });
  const relay = vm.createContext({...globals(clock), window: pageWindow,
    location: {href: receiver}, chrome: {runtime: {sendMessage: send}}});
  vm.runInContext(sources.relay, relay, {filename: sourcePaths.relay});
  const submit = async () => { form.requestSubmit(); await clock.flush(); };
  const snapshot = () => ({at: clock.elapsed(), status: byId('searchStatus').textContent,
    detail: byId('personalStatus').textContent,
    renderedOffers: renderCounts.at(-1)?.count || 0,
    autoBusy: vm.runInContext('autoBusy', background),
    ownedTabs: tabs.size, replies: responses.map(reply => ({at: reply.at, action: reply.action}))});
  return {clock, trace, responses, snapshot, submit, form, send, controls, requests, pageWindow, chrome, session,
    normalizerCalls, renderCounts, background, pageContext};
}


const mainResponse = run => run.responses.find(row => row.action === 'autoSearchPlaytomicClubsFromGet');

test('actual source returns fresh partial results and retires owned work before the unchanged page deadline', async () => {
  const run = await setup(Array.from({length: 4}, () => ({load: 14000})));
  await run.submit();
  await run.clock.advanceTo(45000);
  const reply = mainResponse(run);
  assert.ok(reply, 'Main worker must return a terminal response before the page closes its request');
  assert.ok(reply.at < 45000);
  assert.equal(reply.result.version, '0.4.3');
  assert.equal(reply.result.status, 'partial');
  assert.ok(reply.result.sources.some(row => row.status === 'observed'));
  assert.ok(run.snapshot().renderedOffers > 0);
  assert.equal(run.snapshot().ownedTabs, 0);
  assert.equal(run.snapshot().autoBusy, false);
});

test('fast four-club positive control retains actual schema, EUR decimals and isolated cleanup', async () => {
  const run = await setup(Array.from({length: 4}, () => ({load: 1000})));
  await run.submit(); await run.clock.advanceTo(10000);
  assert.equal(mainResponse(run).at, 9200);
  assert.equal(mainResponse(run).result.sources.filter(row => row.status === 'observed').length, 4);
  assert.equal(run.snapshot().renderedOffers, 4);
  assert.equal(run.normalizerCalls.length, 4);
  assert.equal(run.snapshot().ownedTabs, 0);
  assert.equal(run.snapshot().autoBusy, false);
});

function request(run, patch={}) {
  return {action:'autoSearchPlaytomicClubsFromGet', nonce:'f'.repeat(48),
    deadlineAt:run.clock.now+45000, query:{location:query.location,date:query.date,
      sport:'Padel',from:query.from,to:query.to,durationMinutes:90}, ...patch};
}

test('strict nonce/deadline/sender admission performs no provider operation', async () => {
  for(const patch of [{nonce:'short'}, {nonce:'F'.repeat(48)}, {nonce:undefined},
    {deadlineAt:0}, {deadlineAt:epoch}, {deadlineAt:epoch+45001},
    {deadlineAt:epoch+45000.5}, {extra:true}]) {
    const run=await setup([{load:1000}]);
    assert.equal((await run.send(request(run,patch))).code,'REQUEST_REJECTED');
    assert.equal(run.trace.filter(row=>row.event==='tab-created').length,0);
  }
  for(const sender of [{id:'foreign'}, {frameId:1}, {tab:undefined},
    {url:receiver+'?query=1'}, {url:receiver+'/other'}]) {
    const run=await setup([{load:1000}]);
    assert.equal((await run.send(request(run),false,sender)).code,'REQUEST_REJECTED');
    assert.equal(run.trace.filter(row=>row.event==='tab-created').length,0);
  }
});

test('replayed identity cannot change query or extend the original lifetime', async () => {
  const run=await setup([{load:1000}]);
  await run.submit();
  const original=run.requests[0];
  const replay=request(run,{nonce:original.nonce,deadlineAt:original.deadlineAt});
  assert.equal((await run.send(replay)).code,'REQUEST_REJECTED');
  await run.clock.advanceTo(10000);
  assert.equal((await run.send({...replay,deadlineAt:run.clock.now+45000})).code,'REQUEST_REJECTED');
  await run.clock.advanceTo(60000);
  assert.equal((await run.send(replay)).code,'REQUEST_REJECTED');
  assert.equal(run.trace.filter(row=>row.event==='tab-created').length,1);
});

test('only the requesting authorized tab can cancel its active nonce', async () => {
  const run=await setup([{load:14000}]);await run.submit();
  const nonce=run.requests[0].nonce;
  for(const [message,sender] of [
    [{action:'cancelPlaytomicSearchFromGet',nonce:'e'.repeat(48)},{}],
    [{action:'cancelPlaytomicSearchFromGet',nonce},{tab:{id:2}}],
    [{action:'cancelPlaytomicSearchFromGet',nonce},{id:'foreign'}],
    [{action:'cancelPlaytomicSearchFromGet',nonce,extra:true},{}]
  ])assert.equal((await run.send(message,false,sender)).code,'REQUEST_REJECTED');
  assert.equal(run.snapshot().autoBusy,true);
  assert.equal((await run.send({action:'cancelPlaytomicSearchFromGet',nonce})).status,'cancelled');
  await run.clock.flush();
  assert.equal(run.snapshot().ownedTabs,0);
  assert.equal(run.snapshot().autoBusy,false);
  assert.equal((await run.send({action:'cancelPlaytomicSearchFromGet',nonce})).code,'REQUEST_REJECTED');
});

for(const boundary of ['input','pagehide'])test(boundary+' stops only owned work and rejects late delivery', async () => {
  const run=await setup(Array.from({length:4},()=>({load:14000})));
  await run.submit();await run.clock.advanceTo(5000);
  if(boundary==='input')run.form.dispatchEvent({type:'input'});
  else run.pageWindow.dispatchEvent({type:'pagehide'});
  await run.clock.flush();await run.clock.advanceTo(70000);
  assert.equal(run.snapshot().ownedTabs,0);assert.equal(run.snapshot().autoBusy,false);
  assert.equal(run.snapshot().renderedOffers,0);
  assert.equal(run.trace.filter(row=>row.event==='tab-created').length,1);
  assert.equal(run.trace.filter(row=>row.event==='script-requested').length,0);
});

test('revocation targets the current owned collector with its operation identity', async () => {
  const run=await setup(Array.from({length:4},()=>({load:1000,settles:[5900,5900]})));
  await run.submit();await run.clock.advanceTo(5000);
  await run.send({action:'revoke'},true);await run.clock.flush();
  assert.equal(mainResponse(run).result.code,'CONSENT_WITHDRAWN');
  assert.equal(run.snapshot().autoBusy,false);assert.equal(run.snapshot().ownedTabs,0);
  assert.ok(run.trace.some(row=>row.event==='cancel-delivery'&&row.tab===100));
  assert.equal(run.trace.filter(row=>row.event==='tab-created').length,1);
});

test('pending collector retains busy ownership after deadline until its promise settles', async () => {
  const run=await setup([{load:1000}],{pendingInjection:true});
  await run.submit();await run.clock.advanceTo(45000);
  assert.equal(mainResponse(run).at,43000);
  assert.equal(mainResponse(run).result.sources[0].code,'SEARCH_DEADLINE');
  assert.match(run.snapshot().detail,/time limit/);
  assert.equal(run.snapshot().ownedTabs,0);assert.equal(run.snapshot().autoBusy,true);
  await run.clock.advanceTo(70000);
  assert.equal((await run.send(request(run))).code,'READ_BUSY');
  assert.equal((await run.send({action:'read'},false,
    {url:'chrome-extension://fictional-reader/reader.html'})).code,'READ_BUSY');
  run.controls.resolveCapture();await run.clock.flush();
  assert.equal(run.snapshot().autoBusy,false);assert.equal(run.snapshot().renderedOffers,0);
  assert.ok(run.trace.filter(row=>row.event==='script-requested').every(row=>row.at<43000));
});

for(const kind of ['Create','Window'])test('late '+kind+' resolution is cleaned without later provider work', async () => {
  const run=await setup([{load:1000}],{['defer'+kind]:true});
  await run.submit();await run.clock.advanceTo(45000);
  assert.equal(mainResponse(run).at,43000);assert.equal(run.snapshot().autoBusy,true);
  run.controls['resolve'+kind]();await run.clock.flush();
  assert.equal(run.snapshot().autoBusy,false);assert.equal(run.snapshot().ownedTabs,0);
  assert.equal(run.trace.filter(row=>row.event==='script-requested').length,0);
  assert.ok(run.trace.filter(row=>row.event==='tab-removed').every(row=>row.tab!==77));
  if(kind==='Window')assert.equal(run.trace.filter(row=>row.event==='window-removed').length,1);
});

test('unconfirmed cleanup keeps retired ownership and never retries automatically', async () => {
  const run=await setup([{load:1000}],{removeFails:true});
  await run.submit();await run.clock.advanceTo(70000);
  assert.equal(run.snapshot().autoBusy,true);
  assert.equal((await run.send(request(run))).code,'READ_BUSY');
  assert.equal(run.trace.filter(row=>row.event==='window-remove-attempt').length,1);
  assert.equal(run.trace.filter(row=>row.event==='window-removed').length,0);
});

test('old and unknown main response versions cannot import observations', async () => {
  for(const version of ['0.4.2','9.9.9',undefined]){
    const run=await setup([{load:14000}]);await run.submit();
    run.pageWindow.dispatchEvent({type:'gac:auto-search-response',detail:{
      nonce:run.requests[0].nonce,result:{status:'observed',version,observation:{}}
    }});
    assert.equal(run.snapshot().renderedOffers,0);
    assert.match(run.snapshot().detail,/unsupported replies/);
    run.form.dispatchEvent({type:'input'});await run.clock.flush();
  }
});

test('completed observations at the existing freshness boundary are not retained', async () => {
  const run=await setup([{load:1000,stale:true}]);
  await run.submit();await run.clock.advanceTo(10000);
  assert.equal(mainResponse(run).result.sources[0].code,'OBSERVATION_EXPIRED');
  assert.equal(run.normalizerCalls.length,0);
  assert.equal(run.snapshot().renderedOffers,0);
});

test('the actual collector ignores a foreign nonce and accepts its own cancellation', async () => {
  const run=await setup([{load:1000,settles:[5900,5900]}]);
  await run.submit();await run.clock.advanceTo(5000);
  await run.chrome.tabs.sendMessage(100,{action:'cancelPersonalSearch',nonce:'e'.repeat(48)});
  await run.clock.flush();assert.equal(mainResponse(run),undefined);
  await run.chrome.tabs.sendMessage(100,{action:'cancelPersonalSearch',nonce:run.requests[0].nonce});
  await run.clock.flush();
  assert.equal(mainResponse(run).result.sources[0].code,'CONSENT_WITHDRAWN');
  assert.equal(run.snapshot().ownedTabs,0);
});

test('the actual collector shortens its existing waits to the operation deadline', async () => {
  const clock=new Clock(),trace=[];
  const tab={id:100,url:'https://playtomic.com/clubs/fictional-club-1',
    plan:{settles:[5900,5900]}};
  const provider=createProviderContext(clock,tab,trace);
  const filters={date:query.date,sport:'Padel',from:query.from,to:query.to,durationMinutes:90};
  let result;
  const work=vm.runInContext('searchPlaytomic',provider.context)(filters,
    {nonce:'a'.repeat(48),deadlineAt:clock.now+1000}).then(value=>{result=value;});
  await clock.advanceTo(1000);await work;
  assert.equal(result.readerError,'SEARCH_DEADLINE');
  assert.equal(provider.messages.listeners.size,0);
});

test('reset during the synchronous relay acknowledgement cannot start provider work', async () => {
  const run=await setup([{load:1000}]);
  run.pageWindow.addEventListener('gac:auto-search-accepted',()=>run.form.dispatchEvent({type:'input'}));
  await run.submit();await run.clock.advanceTo(10000);
  assert.equal(run.trace.filter(row=>row.event==='tab-created').length,0);
  assert.equal(mainResponse(run),undefined);
  assert.equal(run.snapshot().renderedOffers,0);
});

test('a cancellation delivered before its start rejects that sender-bound start', async () => {
  const run=await setup([{load:1000}]);
  const message=request(run);
  assert.equal((await run.send({action:'cancelPlaytomicSearchFromGet',nonce:message.nonce})).code,'REQUEST_REJECTED');
  const start=run.send(message);
  await run.clock.advanceTo(10000);
  assert.equal((await start).code,'REQUEST_REJECTED');
  assert.equal(run.trace.filter(row=>row.event==='tab-created').length,0);
});

test('a reordered cancellation from a different tab cannot retire the request', async () => {
  const run=await setup([{load:1000}]);
  const message=request(run);
  assert.equal((await run.send({action:'cancelPlaytomicSearchFromGet',nonce:message.nonce},false,
    {tab:{id:2}})).code,'REQUEST_REJECTED');
  const start=run.send(message);await run.clock.advanceTo(10000);
  assert.equal((await start).sources[0].status,'observed');
  assert.equal(run.snapshot().ownedTabs,0);
});

test('a restarted worker cannot bypass unresolved ownership from the same browser session', async () => {
  const original=await setup([{load:1000}],{pendingInjection:true});
  await original.submit();await original.clock.advanceTo(70000);
  const restarted=await setup([{load:1000}],{session:original.session});
  await restarted.clock.advanceTo(70000);
  const main=restarted.send(request(restarted));
  await restarted.clock.advanceTo(80000);
  assert.equal((await main).code,'READ_BUSY');
  assert.equal((await restarted.send({action:'read'},false,
    {url:'chrome-extension://fictional-reader/reader.html'})).code,'READ_BUSY');
  const {location,...legacyQuery}=request(restarted).query;
  assert.equal((await restarted.send({action:'autoSearchFromGet',query:legacyQuery})).code,'READ_BUSY');
  assert.equal(restarted.trace.filter(row=>row.event==='tab-created').length,0);
  original.controls.resolveCapture();await original.clock.flush();
  assert.equal(original.session.playtomicMainOwnership,undefined);
});
