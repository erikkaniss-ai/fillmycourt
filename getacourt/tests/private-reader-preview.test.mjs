import test from 'node:test';
import assert from 'node:assert/strict';
import {approved,ciState,FILES,CONTENT_SECURITY_POLICY,LEAFLET_HASHES,
  createStaticPackage,readStaticPackageInputs,writeStaticPackage} from '../qa/private-reader-preview.mjs';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,mkdir,readFile,readdir,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const sha='1'.repeat(40),repo={full_name:'erikkaniss-ai/fillmycourt'};
const pr={number:5,state:'open',draft:true,title:'Reader [skip netlify]',
  body:`<!-- GET_STAGING_UAT_APPROVED_SHA:${sha} -->`,
  head:{sha,ref:'get/release-candidate-mvp-qa-04',repo},base:{ref:'getacourt-staging',repo}};
test('protected Reader deploy requires the current single exact SHA approval and original draft scope',()=>{
  assert.equal(approved(pr,sha),true);
  for(const p of [{...pr,body:''},{...pr,body:pr.body+pr.body},{...pr,draft:false},
    {...pr,title:'Reader'},{...pr,head:{...pr.head,sha:'2'.repeat(40)}},
    {...pr,base:{...pr.base,ref:'main'}}])assert.equal(approved(p,sha),false);
});

test('map package pins local Leaflet bytes, serves only finite static assets and permits only OSM images',()=>{
  for(const [ext,sri] of [['js','20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='],
    ['css','p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=']]){
    const path='leaflet-1.9.4.'+ext;
    assert.ok(FILES.includes(path));
    assert.equal(createHash('sha256').update(readFileSync(new URL('../assets/'+path,import.meta.url))).digest('base64'),sri);
  }
  assert.match(readFileSync(new URL('../assets/leaflet-1.9.4-LICENSE.txt',import.meta.url),'utf8'),/Redistribution and use/);
  assert.equal(new Set(FILES).size,FILES.length);
  assert.ok(FILES.every(f=>/^[a-zA-Z0-9.-]+$/.test(f)||/^images\/(?:layers(?:-2x)?|marker-icon(?:-2x)?|marker-shadow)\.png$/.test(f)));
  assert.match(CONTENT_SECURITY_POLICY,/script-src 'self'; style-src 'self';/);
  assert.match(CONTENT_SECURITY_POLICY,/img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(CONTENT_SECURITY_POLICY,/connect-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY,/unsafe-inline|\*|unpkg|playtomic|racket/);
});

const sourceRoot=fileURLToPath(new URL('..',import.meta.url));
const original=await readStaticPackageInputs(sourceRoot);
function changed(name,text){const files=new Map(original);files.set(name,Buffer.from(text));return files;}
function build(files=original,sourceSha=sha){return createStaticPackage({sourceSha,files});}

test('pure finite bundle closes actual Find HTML, module graph, CSS images and vendor runtime roots',()=>{
  const entries=build();
  assert.deepEqual(FILES,[
    'source-catalog.mjs','federated-search.mjs','court-search-page.mjs',
    'personal-source-observation.js','personal-observation-bridge.mjs','player-search-view.mjs','player-search.css',
    'event-discovery.mjs','event-discovery-view.mjs','event-demo-fixtures.mjs','event-discovery.css',
    'leaflet-1.9.4.js','leaflet-1.9.4.css','leaflet-1.9.4-LICENSE.txt',
    'images/layers.png','images/layers-2x.png','images/marker-icon.png','images/marker-icon-2x.png','images/marker-shadow.png']);
  assert.ok(Object.isFrozen(FILES));
  const proof=JSON.parse(entries.get('asset-integrity.json'));
  assert.equal(proof.source_sha,sha);assert.equal(Object.keys(proof.assets).length,20);
  assert.ok(proof.assets['find.html'].dependencies.includes('assets/event-discovery.css'));
  assert.ok(proof.assets['assets/player-search-view.mjs'].dependencies.includes('assets/event-discovery-view.mjs'));
  assert.ok(proof.assets['assets/court-search-page.mjs'].dependencies.includes('assets/event-demo-fixtures.mjs'));
  assert.deepEqual(proof.assets['assets/leaflet-1.9.4.css'].dependencies,
    ['assets/images/layers-2x.png','assets/images/layers.png','assets/images/marker-icon.png']);
  for(const [name,row] of Object.entries(proof.assets)){
    assert.equal(row.sha256,createHash('sha256').update(entries.get(name)).digest('hex'));
    assert.equal(row.bytes,entries.get(name).length);
    assert.deepEqual(entries.get(name),original.get(name));
  }
  for(const [name,hash] of Object.entries(LEAFLET_HASHES))assert.equal(proof.assets[name].sha256,hash);
  assert.deepEqual(JSON.parse(entries.get('preview-build.json')),
    {kind:'GET_READER_STATIC_UAT',source_sha:sha,site_id:'5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570',functions:0,provider_requests:0});
  assert.match(entries.get('_headers').toString(),/Content-Security-Policy: default-src 'none'/);
  assert.match(entries.get('_headers').toString(),/Cache-Control: private, no-store/);
  assert.match(entries.get('netlify.toml').toString(),/directory = "functions"/);
  assert.equal(entries.size,25);assert.ok([...entries.keys()].every(p=>!p.startsWith('functions/')));
});

test('missing new event module or CSS, extra sensitive input, wrong-case keys and invalid source SHA fail closed',()=>{
  for(const name of ['assets/event-discovery.mjs','assets/event-discovery-view.mjs','assets/event-demo-fixtures.mjs','assets/event-discovery.css']){
    const files=new Map(original);files.delete(name);assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  }
  for(const name of ['.env','functions/search.mjs','browser-companion/background.js','assets/auth-pkce.js','assets/../.env']){
    const files=new Map(original);files.set(name,Buffer.from('sensitive-sentinel'));assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  }
  const files=new Map(original);files.set('assets/Event-discovery.mjs',files.get('assets/event-discovery.mjs'));files.delete('assets/event-discovery.mjs');
  assert.throws(()=>build(files),/STATIC_PACKAGE_INPUT_SET/);
  for(const v of ['',sha.toUpperCase(),'latest','../'+sha,'g'.repeat(40)])if(v!==sha)assert.throws(()=>build(original,v),/STATIC_PACKAGE_INPUT/);
});

test('transitive module paths reject traversal, case mismatch, escaped paths, remote, queries and unknown additions',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  for(const ref of ['./Event-discovery.mjs','../assets/event-discovery.mjs','./../assets/event-discovery.mjs',
    './event-discovery.mjs?x=1','./event-discovery.mjs#x','./%65vent-discovery.mjs',
    './event\\u002ddiscovery.mjs','https://provider.invalid/a.mjs','//provider.invalid/x','/assets/event-discovery.mjs',
    './auth-pkce.js','./missing.mjs','./images//layers.png']){
    assert.throws(()=>build(changed('assets/event-demo-fixtures.mjs',`import '${ref}';\n`+base)),/STATIC_PACKAGE_(REFERENCE|UNREVIEWED_DEPENDENCY)/);
  }
});

test('static re-exports close dependencies; comments, regex, strings and template text are not executable imports',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  const files=changed('assets/event-demo-fixtures.mjs',`// import './missing.mjs';
/* export * from './missing.mjs'; */
const fake="import './missing.mjs'"; const pattern=/import\\(['"]missing/;
const template=\`import('./missing.mjs')\`;
export {eventKey} from './event-discovery.mjs';
`+base);
  const proof=JSON.parse(build(files).get('asset-integrity.json'));
  assert.deepEqual(proof.assets['assets/event-demo-fixtures.mjs'].dependencies,['assets/event-discovery.mjs']);
});

test('dynamic or computed imports fail closed including nested template expressions',()=>{
  const base=original.get('assets/event-demo-fixtures.mjs').toString();
  for(const expression of ["import('./event-discovery.mjs')","import(variable)","import /* gap */ ('./event-discovery.mjs')",
    '`value ${import("./missing.mjs")}`','import.meta.url']){
    assert.throws(()=>build(changed('assets/event-demo-fixtures.mjs',base+'\nconst extra='+expression+';')),/STATIC_PACKAGE_DYNAMIC_MODULE/);
  }
});

test('HTML resource references, inline active code, remote CSS and obfuscated CSS cannot widen the bundle',()=>{
  const html=original.get('find.html').toString(),css=original.get('assets/event-discovery.css').toString();
  for(const extra of ['<script src="assets/app.js"></script>','<link rel="stylesheet" href="https://provider.invalid/x.css">',
    '<img src="../secret.png">','<script>alert(1)</script>','<style>body{}</style>','<iframe src="find.html"></iframe>',
    '<img srcset="assets/images/marker-icon.png 2x">','<body onload="alert(1)">']){
    assert.throws(()=>build(changed('find.html',html+extra)),/STATIC_PACKAGE_/);
  }
  for(const extra of ['@import "https://provider.invalid/x.css";','@import url(./missing.css);',
    '.x{background:url(./missing.png)}','.x{background:url(../secret.png)}',
    '.x{background:u\\72l(./missing.png)}']){
    assert.throws(()=>build(changed('assets/event-discovery.css',css+'\n'+extra)),/STATIC_PACKAGE_/);
  }
});

test('unused manifest assets and altered pinned vendor bytes are rejected',()=>{
  const html=original.get('find.html').toString().replace('<link rel="stylesheet" href="assets/event-discovery.css">','');
  assert.throws(()=>build(changed('find.html',html)),/STATIC_PACKAGE_UNREACHABLE_ASSET/);
  for(const name of Object.keys(LEAFLET_HASHES))assert.throws(()=>build(changed(name,'tampered vendor bytes')),/STATIC_PACKAGE_VENDOR_INTEGRITY/);
});

test('local disk writer creates only validated static files and an empty functions directory, refuses a stale destination',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-package-')),output=join(temp,'bundle');
  const result=await writeStaticPackage({sourceRoot,sourceSha:sha,output});assert.equal(result.files,25);
  assert.deepEqual(await readdir(join(output,'functions')),[]);
  assert.deepEqual(JSON.parse(await readFile(join(output,'preview-build.json'),'utf8')).source_sha,sha);
  await writeFile(join(output,'functions','must-not-survive.js'),'synthetic');
  await assert.rejects(writeStaticPackage({sourceRoot,sourceSha:sha,output}),{code:'EEXIST'});
  assert.equal(await readFile(join(output,'functions','must-not-survive.js'),'utf8'),'synthetic');
});

test('filesystem loader detects missing and wrong-case files before writing output',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-missing-'));await mkdir(join(temp,'assets'));
  await writeFile(join(temp,'Find.html'),original.get('find.html'));
  await assert.rejects(readStaticPackageInputs(temp),/STATIC_PACKAGE_EXACT_CASE_OR_MISSING_ASSET/);
});

test('filesystem loader rejects symlink assets on platforms with symlink support',async t=>{
  const temp=await mkdtemp(join(tmpdir(),'gac-symlink-'));await mkdir(join(temp,'assets'));
  await writeFile(join(temp,'find.html'),original.get('find.html'));
  const target=join(temp,'target.txt');await writeFile(target,'synthetic');
  try{await symlink(target,join(temp,'assets','source-catalog.mjs'));}
  catch(e){if(e.code==='EPERM'){t.skip('Windows symlink privilege unavailable; Linux CI exercises this boundary');return;}throw e;}
  await assert.rejects(readStaticPackageInputs(temp),/STATIC_PACKAGE_SYMLINK/);
});

test('CLI prepare remains CI-only and local packaging never spoofs GITHUB_ACTIONS',()=>{
  const script=fileURLToPath(new URL('../qa/private-reader-preview.mjs',import.meta.url));
  const env={...process.env,SOURCE_SHA:sha};delete env.GITHUB_ACTIONS;delete env.GITHUB_TOKEN;
  const result=spawnSync(process.execPath,[script,'--prepare'],{env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/CI_STATIC_PACKAGE_ONLY/);
});
test('only latest successful real PR workflows count; stale or later failures cannot inherit success',()=>{
  const paths=['platform-ci','getacourt-a11y-ci','getacourt-offline-safety-ci'];
  const runs=paths.map(name=>({path:'.github/workflows/'+name+'.yml',head_sha:sha,event:'pull_request',
    head_branch:pr.head.ref,head_repository:repo,run_number:2,run_attempt:1,status:'completed',conclusion:'success'}));
  assert.equal(ciState(runs,sha),true);
  assert.equal(ciState(runs.slice(1),sha),false);
  assert.equal(ciState(runs,'2'.repeat(40)),false);
  assert.equal(ciState([...runs,{...runs[0],run_number:3,conclusion:'failure'}],sha),false);
  assert.equal(FILES.some(f=>/app\.js|auth|book|checkout|provider-connection/.test(f)),false);
});
