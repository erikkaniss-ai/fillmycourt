import test from 'node:test';import assert from 'node:assert/strict';
import {approved,FILES} from '../qa/private-search-preview.mjs';
import {ciState} from '../qa/private-reader-preview.mjs';
import {readFileSync} from 'node:fs';
test('Search retains the actual shared fail-closed CI function before protection without network qualification',()=>{
  const consumer=readFileSync(new URL('../qa/private-search-preview.mjs',import.meta.url),'utf8');
  assert.match(consumer,/import \{ciState\} from '\.\/private-reader-preview\.mjs'/);
  assert.match(consumer,/if\(ciState\(result\.workflow_runs\?\?\[\],sha\)\)/);
  assert.ok(consumer.indexOf('if(ciState(')<consumer.indexOf("fetch('https://deploy-preview-5"));
  const sha='1'.repeat(40),paths=['platform-ci','getacourt-a11y-ci','getacourt-offline-safety-ci'];
  const runs=paths.map((name,i)=>({id:i+1,run_number:2,run_attempt:1,head_sha:sha,event:'pull_request',
    path:'.github/workflows/'+name+'.yml',head_branch:'get/release-candidate-mvp-qa-04',
    head_repository:{full_name:'erikkaniss-ai/fillmycourt'},pull_requests:[{number:5}],status:'completed',conclusion:'success'}));
  assert.equal(ciState(runs,sha),true);
  for(const index of [0,1,2])for(const field of ['head_repository','head_branch']){
    const newer={...runs[index],id:20,run_number:3,conclusion:'failure'};delete newer[field];
    assert.equal(ciState([...runs,newer],sha),false);
  }
});
test('search draft cannot borrow Reader GO, stale head, public publishing or a non-draft PR',()=>{
  const sha='a'.repeat(40),pr={number:5,state:'open',draft:true,title:'candidate [skip netlify]',head:{sha,ref:'get/release-candidate-mvp-qa-04',repo:{full_name:'erikkaniss-ai/fillmycourt'}},base:{ref:'getacourt-staging'},body:'<!-- GET_SEARCH_UAT_APPROVED_SHA:'+sha+' -->'};
  assert.equal(approved(pr,sha),true);
  for(const patch of [{draft:false},{number:8},{body:pr.body+pr.body},{body:pr.body.replace('GET_SEARCH','GET_STAGING')},{title:'publish'},{head:{...pr.head,sha:'b'.repeat(40)}}])assert.equal(approved({...pr,...patch},sha),false);
  assert.equal(FILES.filter(p=>p.startsWith('netlify/functions/')).length,1);
  assert.ok(FILES.every(p=>!/(booking|payment|personal|browser-companion|fixture)/.test(p)));
});
