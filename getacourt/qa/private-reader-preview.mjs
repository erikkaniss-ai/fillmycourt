// Static, protected Reader UAT only. No function, booking UI or provider feed.
import {readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
export const SITE='5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570';
export const RECEIVER='https://get-pr5-reader-uat--getacourt-preview.netlify.app';
const REPO='erikkaniss-ai/fillmycourt';
const SHA=/^[a-f0-9]{40}$/;
export const FILES=['source-catalog.mjs','federated-search.mjs','federated-search-page.mjs',
  'personal-source-observation.js','personal-observation-bridge.mjs','federated-search.css'];
export function approved(pr,sha){
  const marks=[...(pr?.body??'').matchAll(/<!-- GET_STAGING_UAT_APPROVED_SHA:([a-f0-9]{40}) -->/g)];
  return SHA.test(sha??'')&&pr?.number===5&&pr.state==='open'&&pr.draft===true&&
    pr.head?.sha===sha&&pr.head?.ref==='get/release-candidate-mvp-qa-04'&&
    pr.head?.repo?.full_name===REPO&&pr.base?.ref==='getacourt-staging'&&
    pr.base?.repo?.full_name===REPO&&pr.title?.includes('[skip netlify]')&&
    marks.length===1&&marks[0][1]===sha;
}
export function ciState(runs,sha){
  const paths=['.github/workflows/platform-ci.yml','.github/workflows/getacourt-a11y-ci.yml',
    '.github/workflows/getacourt-offline-safety-ci.yml'];
  return paths.every(path=>{
    const latest=runs.filter(r=>r.path===path&&r.head_sha===sha&&r.event==='pull_request'&&
      r.head_branch==='get/release-candidate-mvp-qa-04'&&r.head_repository?.full_name===REPO)
      .sort((a,b)=>b.run_number-a.run_number||b.run_attempt-a.run_attempt)[0];
    return latest?.status==='completed'&&latest.conclusion==='success';
  });
}
async function api(path){
  if(!process.env.GITHUB_TOKEN)throw Error('GITHUB_READ_TOKEN_MISSING');
  const r=await fetch('https://api.github.com/repos/'+REPO+path,{headers:{
    accept:'application/vnd.github+json',authorization:'Bearer '+process.env.GITHUB_TOKEN,
  },signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('GITHUB_READ_FAILED');return r.json();
}
async function gate(){
  const sha=process.env.SOURCE_SHA;
  if(!approved(await api('/pulls/5'),sha))throw Error('EXACT_OWNER_UAT_GO_MISSING_OR_STALE');
  for(let i=0;i<20;i++){
    const result=await api('/actions/runs?head_sha='+sha+'&event=pull_request&per_page=100');
    if(ciState(result.workflow_runs??[],sha)){
      if(!approved(await api('/pulls/5'),sha))throw Error('PR_CHANGED');
      const r=await fetch('https://getacourt-staging--getacourt-preview.netlify.app/',{redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(r.status!==401)throw Error('EXISTING_NONPRODUCTION_PROTECTION_UNVERIFIED');
      console.log('Exact PR5 approval, required CI and existing protected preview verified.');return;
    }
    if(i===19)throw Error('REQUIRED_CI_NOT_GREEN');
    await new Promise(r=>setTimeout(r,15000));
  }
}
async function prepare(){
  const sha=process.env.SOURCE_SHA,temp=process.env.RUNNER_TEMP;
  if(!SHA.test(sha??'')||!temp||process.env.GITHUB_ACTIONS!=='true')throw Error('CI_STATIC_PACKAGE_ONLY');
  const output=resolve(temp,'get-reader-static');
  await mkdir(join(output,'assets'),{recursive:true});await mkdir(join(output,'functions'),{recursive:true});
  const html=await readFile('getacourt/search-all.html','utf8');
  await writeFile(join(output,'search-all.html'),html.replace('<main>','<main><p class="notice">Private Reader acceptance: Core API is disconnected on this static draft. Personal offers are short-lived browser observations.</p>'));
  for(const file of FILES)await copyFile('getacourt/assets/'+file,join(output,'assets',file));
  await writeFile(join(output,'preview-build.json'),JSON.stringify({kind:'GET_READER_STATIC_UAT',source_sha:sha,site_id:SITE,functions:0,provider_requests:0}));
  await writeFile(join(output,'_redirects'),'/ /search-all.html 302\n/index.html /search-all.html 302\n');
  await writeFile(join(output,'netlify.toml'),'[build]\npublish = "."\n[functions]\ndirectory = "functions"\n');
  await writeFile(join(output,'_headers'),"/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: private, no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'\n");
  console.log('Static Reader package prepared: no server functions, native booking UI or secrets.');
}
async function verify(){
  const result=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,'get-reader-static-result.json'),'utf8'));
  if(new URL(result.deploy_url||result.deployUrl||result.url||'').origin!==RECEIVER||
    (result.site_id&&result.site_id!==SITE))throw Error('UNEXPECTED_DEPLOY_TARGET');
  const r=await fetch(RECEIVER+'/search-all.html',{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(r.status!==401)throw Error('NEW_DRAFT_PROTECTION_UNVERIFIED');
  console.log('Protected Reader draft anonymous HTTP 401 verified: '+RECEIVER);
  console.log('Reviewed source SHA: '+process.env.SOURCE_SHA+'; deploy ID: '+result.deploy_id);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const action=process.argv[2];
  (action==='--gate'?gate():action==='--prepare'?prepare():action==='--verify'?verify():Promise.reject(Error('UNKNOWN_ACTION')))
    .catch(error=>{console.error('PRIVATE_READER_PREVIEW_BLOCKED:',error.message);process.exitCode=1;});
}
