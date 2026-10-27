import test from 'node:test';import assert from 'node:assert/strict';
import {approved,FILES} from '../qa/private-search-preview.mjs';
test('search draft cannot borrow Reader GO, stale head, public publishing or a non-draft PR',()=>{
  const sha='a'.repeat(40),pr={number:5,state:'open',draft:true,title:'candidate [skip netlify]',head:{sha,ref:'get/release-candidate-mvp-qa-04',repo:{full_name:'erikkaniss-ai/fillmycourt'}},base:{ref:'getacourt-staging'},body:'<!-- GET_SEARCH_UAT_APPROVED_SHA:'+sha+' -->'};
  assert.equal(approved(pr,sha),true);
  for(const patch of [{draft:false},{number:8},{body:pr.body+pr.body},{body:pr.body.replace('GET_SEARCH','GET_STAGING')},{title:'publish'},{head:{...pr.head,sha:'b'.repeat(40)}}])assert.equal(approved({...pr,...patch},sha),false);
  assert.equal(FILES.filter(p=>p.startsWith('netlify/functions/')).length,1);
  assert.ok(FILES.every(p=>!/(booking|payment|personal|browser-companion|fixture)/.test(p)));
});
