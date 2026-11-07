// One read-only server search function, existing protected Get site, draft only.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {ciState} from './private-reader-preview.mjs';
export const SITE='5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570';
export const RECEIVER='https://get-pr5-search-uat--getacourt-preview.netlify.app';
export const FILES=['getacourt/find.html',...['federated-search.css','source-catalog.mjs','federated-search.mjs','court-search-page.mjs'].map(p=>'getacourt/assets/'+p),
  'netlify/functions/getacourt-search-all.mts','netlify/lib/platform.mts','netlify/lib/club-availability.mjs'];
export function approved(pr,sha){
  const marks=[...(pr?.body??'').matchAll(/<!-- GET_SEARCH_UAT_APPROVED_SHA:([a-f0-9]{40}) -->/g)];
  return /^[a-f0-9]{40}$/.test(sha??'')&&pr?.number===5&&pr.state==='open'&&pr.draft===true&&
    pr.head?.sha===sha&&pr.head?.ref==='get/release-candidate-mvp-qa-04'&&pr.head?.repo?.full_name==='erikkaniss-ai/fillmycourt'&&
    pr.base?.ref==='getacourt-staging'&&pr.title?.includes('[skip netlify]')&&marks.length===1&&marks[0][1]===sha;
}
async function api(path){
  if(!process.env.GITHUB_TOKEN)throw Error('READ_TOKEN_MISSING');
  const r=await fetch('https://api.github.com/repos/erikkaniss-ai/fillmycourt'+path,{headers:{accept:'application/vnd.github+json',authorization:'Bearer '+process.env.GITHUB_TOKEN},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('GITHUB_READ_FAILED');return r.json();
}
async function gate(){
  const sha=process.env.SOURCE_SHA;if(!approved(await api('/pulls/5'),sha))throw Error('EXACT_SEARCH_UAT_SCOPE_MISSING');
  for(let i=0;i<40;i++){
    const result=await api('/actions/runs?head_sha='+sha+'&event=pull_request&per_page=100');
    if(ciState(result.workflow_runs??[],sha)){
      if(!approved(await api('/pulls/5'),sha))throw Error('PR_CHANGED');
      const r=await fetch('https://deploy-preview-5--getacourt-preview.netlify.app/',{redirect:'manual',signal:AbortSignal.timeout(15000)});
      if(r.status!==401)throw Error('PROTECTED_PREVIEW_UNVERIFIED');return;
    }
    if(i===39)throw Error('REQUIRED_CI_NOT_GREEN');await new Promise(r=>setTimeout(r,15000));
  }
}
async function prepare(){
  const sha=process.env.SOURCE_SHA;if(!/^[a-f0-9]{40}$/.test(sha??'')||!process.env.RUNNER_TEMP||process.env.GITHUB_ACTIONS!=='true')throw Error('CI_PACKAGE_ONLY');
  const out=resolve(process.env.RUNNER_TEMP,'get-search-direct');
  for(const file of FILES){await mkdir(dirname(join(out,file)),{recursive:true});await copyFile(file,join(out,file));}
  await writeFile(join(out,'getacourt','_redirects'),'/ /find.html 302\n/index.html /find.html 302\n');
  await writeFile(join(out,'getacourt','preview-build.json'),JSON.stringify({kind:'GET_DIRECT_SEARCH_UAT',source_sha:sha,functions:1,live_source_acceptance:false}));
  await writeFile(join(out,'getacourt','_headers'),"/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: private, no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'\n");
  await writeFile(join(out,'netlify.toml'),'[build]\npublish = "getacourt"\n[functions]\ndirectory = "netlify/functions"\nnode_bundler = "esbuild"\n');
}
async function verify(){
  const r=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,'get-search-result.json'),'utf8'));
  if(new URL(r.deploy_url||r.deployUrl||r.url||'').origin!==RECEIVER||(r.site_id&&r.site_id!==SITE))throw Error('WRONG_TARGET');
  for(const path of ['/find.html','/api/gac/search-all?location=Cascais']){
    const response=await fetch(RECEIVER+path,{redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status!==401)throw Error('PRIVATE_PAGE_OR_API_UNPROTECTED');
  }
  console.log('Protected search page and API: anonymous HTTP 401. Source '+process.env.SOURCE_SHA+'; deploy ID '+r.deploy_id);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  const command=process.argv[2];(command==='--gate'?gate():command==='--prepare'?prepare():command==='--verify'?verify():Promise.reject(Error('UNKNOWN_ACTION')))
    .catch(error=>{console.error('PRIVATE_SEARCH_BLOCKED:',error.message);process.exitCode=1;});
}
