import test from 'node:test';
import assert from 'node:assert/strict';
import {approved,ciState,FILES,CONTENT_SECURITY_POLICY} from '../qa/private-reader-preview.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
  assert.ok(FILES.every(f=>/^[a-zA-Z0-9.-]+$/.test(f)));
  assert.match(CONTENT_SECURITY_POLICY,/script-src 'self'; style-src 'self';/);
  assert.match(CONTENT_SECURITY_POLICY,/img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(CONTENT_SECURITY_POLICY,/connect-src 'none'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY,/unsafe-inline|\*|unpkg|playtomic|racket/);
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
