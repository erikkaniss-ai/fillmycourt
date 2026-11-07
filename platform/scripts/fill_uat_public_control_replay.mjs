// Source-only replay. No tools, SQL, HTTP, credentials or actual child factory.
import {installFillNode,ROOT} from './fill_uat_foreground_controller.mjs';
import {publicFixture} from './fill_uat_synthetic_wire_child.mjs';
import {copyDto,exact,instant} from './fill_uat_evidence_verdict.mjs';

export async function createPublicDiscoveryReplay({originalT0,frames}) {
  const original=instant(originalT0),base=Date.parse('2030-01-01T00:00:00Z');
  if(!Array.isArray(frames)||frames.length<1||frames.length>3)throw Error('PUBLIC_FRAME_REJECTED');
  const fixture=publicFixture(),scope={run_id:fixture.binding.run_id,authorization_id:fixture.binding.authorization_id};
  const at=text=>{const n=base+instant(text)-original,ms=Math.floor(n),us=Math.round((n-ms)*1000);return new Date(ms).toISOString().replace(/(\.\d{3})Z$/,'$1'+String(us).padStart(3,'0')+'Z');};
  const snapshots=frames.map(input=>{
    const s=copyDto(input);exact(s,['run_id','authorization_id','candidate_sha','project_ref','deployment_id','starts_at','observed_at','stopped','reconciliation_required','lease_digest','attempts']);
    if(!Array.isArray(s.attempts)||s.attempts.length>1||s.lease_digest!==null)throw Error('PUBLIC_FRAME_REJECTED');
    return {...s,...scope,deployment_id:'00000000-0000-0000-0000-000000009999',starts_at:s.starts_at===null?null:at(s.starts_at),observed_at:at(s.observed_at),
      attempts:s.attempts.map(a=>{exact(a,['label','operation','user_id','verified','settled','reserved_at']);if(a.label!=='canary'||a.operation!=='create')throw Error('PUBLIC_FRAME_REJECTED');return {...a,user_id:a.user_id===null?null:fixture.binding.identities.canary,reserved_at:at(a.reserved_at)};})};
  });
  let wall=base,mono=0,launches=0;
  const prepared={trustedOwnerReceiptVerified:true,trustedSourceAcceptanceVerified:true,source_sha:'0'.repeat(40),accepted_source_sha:'0'.repeat(40),...scope,max_new_accounts:3,public_go:false,consumed:false,
    owner_issued_at:new Date(base-1000).toISOString(),client_plan:fixture.config.plan,passwords:Object.fromEntries(Object.entries(fixture.config.plan.principals).map(([k,v])=>[k,v.password]))};
  const driver=await installFillNode(scope,{publicOnly:true,moduleRoot:ROOT,prepared,wall:()=>wall,monotonic:()=>mono,factory:()=>{launches++;throw Error('PUBLIC_FACTORY_MUST_NOT_RUN');}});
  return {
    begin(index){if(!snapshots[index])throw Error('PUBLIC_FRAME_REJECTED');const next=instant(snapshots[index].observed_at)+1;mono+=Math.max(0,next-wall);wall=next;driver.begin();return{publicOnly:true,index};},
    complete(index){if(!snapshots[index])throw Error('PUBLIC_FRAME_REJECTED');return driver.complete({discovery:true},JSON.parse(JSON.stringify([{snapshot:snapshots[index]}])));},
    stop(){return driver.stop();},
    status(){return{...driver.status(),publicOnly:true,actualProcessLaunches:launches,grantsOwnerGo:false};}
  };
}
