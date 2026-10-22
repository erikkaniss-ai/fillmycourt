import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryScope} from '../delivery.mjs';
test('pilot and future roadmap overlays can never grant launch or manufacture percentages',()=>{
  const review={delivery:{pilotGoal:'Fictional pilot',launchStatus:'READY',launchApproved:true,progress:100,
    blockers:[{name:'Missing exact hosted receipt',owner:'QA',go:'Separate owner approval'}],
    active:[{name:'Core',scope:'Fictional active scope',status:'ACCEPTED',progress:100}],
    future:[{name:'Future module',scope:'Not in base MVP',status:'READY',progress:100}]}};
  const result=deliveryScope(review,{kind:'product'},[{acceptance:'ACCEPTED'}]);
  assert.equal(result.launchStatus,'UNKNOWN');assert.equal(result.launchApproved,false);
  assert.equal(result.active[0].progress,null);assert.equal(result.future[0].progress,null);
  assert.equal(result.future[0].status,'UNKNOWN');assert.equal(result.progress,undefined);
  assert.equal(deliveryScope(review,{kind:'product'},[{acceptance:'FAILED'}]).launchStatus,'BLOCKED');
  assert.equal(deliveryScope(review,{kind:'enabler'},[]),null);
  assert.equal(deliveryScope({}, {kind:'product'},[]),null);
});
test('scope overlays only expose bounded named fields and retain UNKNOWN',()=>{
  const result=deliveryScope({delivery:{pilotGoal:'x'.repeat(401),future:[{name:'Missing scope'},...Array.from({length:15},()=>({name:'Service',scope:'Unverified',secret:'never-export'}))]}},{kind:'product'},[]);
  assert.equal(result.pilotGoal,null);assert.ok(result.future.length<=12);
  assert.equal(JSON.stringify(result).includes('never-export'),false);
  assert.equal(result.launchStatus,'UNKNOWN');
});
