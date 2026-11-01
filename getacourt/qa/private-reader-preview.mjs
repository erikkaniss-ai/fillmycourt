// Static, protected Reader UAT only. No function, booking UI or provider feed.
import {readFile,mkdir,writeFile,lstat,readdir} from 'node:fs/promises';
import {resolve,join,posix} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export const SITE='5dbcc4a3-5c87-4c75-959f-9a4f9fbc9570';
export const RECEIVER='https://get-pr5-reader-uat--getacourt-preview.netlify.app';
const REPO='erikkaniss-ai/fillmycourt';
const SHA=/^[a-f0-9]{40}$/;
export const FILES=Object.freeze(['source-catalog.mjs','federated-search.mjs','court-search-page.mjs',
  'personal-source-observation.js','personal-observation-bridge.mjs',
  'player-search-view.mjs','player-search.css','event-discovery.mjs','event-discovery-view.mjs',
  'event-demo-fixtures.mjs','event-discovery.css',
  'leaflet-1.9.4.js','leaflet-1.9.4.css','leaflet-1.9.4-LICENSE.txt',
  'images/layers.png','images/layers-2x.png','images/marker-icon.png',
  'images/marker-icon-2x.png','images/marker-shadow.png']);
export const CONTENT_SECURITY_POLICY="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const INPUTS=Object.freeze(['find.html',...FILES.map(f=>'assets/'+f)]);
// Official npm leaflet@1.9.4 distribution. Vendor code is not rewritten or executed
// by the packager. The two JS-created default marker images are explicit roots.
export const LEAFLET_HASHES=Object.freeze({
  'assets/leaflet-1.9.4.js':'db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a',
  'assets/leaflet-1.9.4.css':'a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6',
  'assets/images/layers.png':'1dbbe9d028e292f36fcba8f8b3a28d5e8932754fc2215b9ac69e4cdecf5107c6',
  'assets/images/layers-2x.png':'066daca850d8ffbef007af00b06eac0015728dee279c51f3cb6c716df7c42edf',
  'assets/images/marker-icon.png':'574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437',
  'assets/images/marker-icon-2x.png':'00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528',
  'assets/images/marker-shadow.png':'264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da',
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function invalid(code){throw Error('STATIC_PACKAGE_'+code);}
function assetPath(owner,ref){
  // Literal relative paths only: URL normalization must not hide traversal,
  // escaping, case changes, query strings, fragments or remote imports.
  if(typeof ref!=='string'||!ref||/[^A-Za-z0-9_./-]/.test(ref)||ref.startsWith('/')||
    ref.split('/').some(p=>p==='..'||p==='')||ref==='.'||ref.endsWith('/'))invalid('REFERENCE');
  const path=posix.join(posix.dirname(owner),ref);
  if(!INPUTS.includes(path))invalid('UNREVIEWED_DEPENDENCY');
  return path;
}
// Constrained, fail-closed JS dependency lexer. It does not execute modules.
// Comments/regex/string/template text are not imports; template expressions are
// lexed recursively. Only literal static imports/re-exports are admitted.
function moduleReferences(source){
  const tokens=[];let i=0,depth=0;
  function quoted(quote){
    let value='';i++;
    while(i<source.length){const c=source[i++];if(c===quote)return value;
      if(c==='\\'){value+=c+(source[i++]??'');}else value+=c;}
    invalid('JS_SYNTAX');
  }
  function code(stop=false){
    if(++depth>32)invalid('JS_SYNTAX');
    while(i<source.length){
      const c=source[i],n=source[i+1],previous=tokens.at(-1)?.value;
      if(/\s/.test(c)){i++;continue;}
      if(c==='/'&&n==='/'){i=source.indexOf('\n',i+2);if(i<0)i=source.length;continue;}
      if(c==='/'&&n==='*'){const end=source.indexOf('*/',i+2);if(end<0)invalid('JS_SYNTAX');i=end+2;continue;}
      if(c==='"'||c==="'"){tokens.push({string:true,value:quoted(c)});continue;}
      if(c==='`'){
        i++;let closed=false;
        while(i<source.length){if(source[i]==='\\'){i+=2;continue;}
          if(source[i]==='`'){i++;closed=true;break;}
          if(source[i]==='$'&&source[i+1]==='{'){i+=2;tokens.push({value:'('});code(true);tokens.push({value:')'});}
          else i++;}
        if(!closed)invalid('JS_SYNTAX');tokens.push({string:true,value:'<template>'});continue;
      }
      if(c==='/'&&(!previous||['(','[','{','=',':',',',';','!','?','&&','||','return','=>'].includes(previous))){
        i++;let bracket=false,closed=false;
        while(i<source.length){const r=source[i++];if(r==='\\'){i++;continue;}
          if(r==='[')bracket=true;if(r===']')bracket=false;
          if(r==='/'&&!bracket){closed=true;break;}if(r==='\n')invalid('JS_SYNTAX');}
        if(!closed)invalid('JS_SYNTAX');while(/[a-z]/i.test(source[i]??'')&&i<source.length)i++;
        tokens.push({value:'<regex>'});continue;
      }
      if(stop&&c==='}'){i++;depth--;return;}
      if(c==='{'){i++;tokens.push({value:c});code(true);tokens.push({value:'}'});continue;}
      const word=source.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0];
      if(word){tokens.push({value:word});i+=word.length;continue;}
      const pair=source.slice(i,i+2);if(['=>','&&','||'].includes(pair)){tokens.push({value:pair});i+=2;}
      else{tokens.push({value:c});i++;}
    }
    if(stop)invalid('JS_SYNTAX');depth--;
  }
  code();const refs=[];
  for(let k=0;k<tokens.length;k++){
    const t=tokens[k];if(t.string||tokens[k-1]?.value==='.')continue;
    if(t.value==='import'){
      const next=tokens[k+1];if(next?.value==='('||next?.value==='.')invalid('DYNAMIC_MODULE');
      if(next?.string){refs.push(next.value);continue;}
      let end=k+1;while(end<tokens.length&&tokens[end].value!==';')end++;
      const from=tokens.slice(k+1,end).findIndex(x=>!x.string&&x.value==='from');
      const ref=tokens[k+from+2];if(from<0||!ref?.string)invalid('MODULE_IMPORT');refs.push(ref.value);
    }else if(t.value==='export'&&['{','*'].includes(tokens[k+1]?.value)){
      let end=k+1;while(end<tokens.length&&tokens[end].value!==';')end++;
      const from=tokens.slice(k+1,end).findIndex(x=>!x.string&&x.value==='from');
      if(from>=0){const ref=tokens[k+from+2];if(!ref?.string)invalid('MODULE_IMPORT');refs.push(ref.value);}
    }
  }
  return refs;
}
function htmlReferences(text){
  const refs=[];text=text.replace(/<!--[\s\S]*?-->/g,'');
  if(/<\s*(?:base|iframe|object|embed|style)\b/i.test(text))invalid('HTML_ACTIVE_CONTENT');
  for(const tag of text.matchAll(/<([a-z][\w-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)){
    const name=tag[1].toLowerCase(),attrs=new Map();
    for(const a of tag[2].matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)){
      const key=a[1].toLowerCase();if(attrs.has(key))invalid('HTML_ATTRIBUTE');attrs.set(key,a[2]??a[3]??a[4]??'');
    }
    if([...attrs.keys()].some(a=>a==='style'||a.startsWith('on')||a==='srcset'))invalid('HTML_ACTIVE_CONTENT');
    if(name==='script'&&!attrs.has('src'))invalid('INLINE_SCRIPT');
    if(attrs.has('src'))refs.push(attrs.get('src'));
    if(name==='link'&&attrs.has('href'))refs.push(attrs.get('href'));
    if(attrs.has('poster'))refs.push(attrs.get('poster'));
  }
  return refs;
}
function cssReferences(text){
  text=text.replace(/\/\*[\s\S]*?\*\//g,'');const refs=[];
  if(text.includes('\\'))invalid('CSS_ESCAPE');
  const imports=[...text.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)')\s*\)?[^;]*;/gi)];
  if((text.match(/@import\b/gi)??[]).length!==imports.length)invalid('CSS_IMPORT');
  refs.push(...imports.map(m=>m[1]??m[2]));
  for(const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'" ]+))\s*\)/gi)){
    const ref=m[1]??m[2]??m[3];if(ref.startsWith('#'))continue;refs.push(ref);
  }
  if((text.match(/url\(/gi)??[]).length!==[...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'" ]+))\s*\)/gi)].length)invalid('CSS_URL');
  return refs;
}
export function createStaticPackage({sourceSha,files}){
  if(!SHA.test(sourceSha??'')||!(files instanceof Map))invalid('INPUT');
  if(files.size!==INPUTS.length||[...files.keys()].some(p=>!INPUTS.includes(p)))invalid('INPUT_SET');
  const inputs=new Map();
  for(const name of INPUTS){const value=files.get(name);
    if(!(typeof value==='string'||value instanceof Uint8Array))invalid('MISSING_ASSET');
    const bytes=Buffer.from(value);if(!bytes.length||bytes.length>512*1024)invalid('ASSET_SIZE');
    if(LEAFLET_HASHES[name]&&digest(bytes)!==LEAFLET_HASHES[name])invalid('VENDOR_INTEGRITY');inputs.set(name,bytes);
  }
  const graph={};
  for(const [name,bytes] of inputs){
    const text=bytes.toString('utf8');
    const refs=name.endsWith('.html')?htmlReferences(text):name.endsWith('.css')?cssReferences(text):
      name.endsWith('.mjs')||name==='assets/personal-source-observation.js'?moduleReferences(text):[];
    graph[name]=[...new Set(refs.map(ref=>assetPath(name,ref)))].sort();
  }
  const seen=new Set(),visit=name=>{if(seen.has(name))return;seen.add(name);for(const dep of graph[name])visit(dep);};
  for(const root of ['find.html','assets/leaflet-1.9.4-LICENSE.txt','assets/images/marker-icon-2x.png','assets/images/marker-shadow.png'])visit(root);
  if(seen.size!==inputs.size)invalid('UNREACHABLE_ASSET');
  const entries=new Map(inputs);
  entries.set('preview-build.json',Buffer.from(JSON.stringify({kind:'GET_READER_STATIC_UAT',source_sha:sourceSha,site_id:SITE,functions:0,provider_requests:0})));
  entries.set('asset-integrity.json',Buffer.from(JSON.stringify({version:1,source_sha:sourceSha,
    assets:Object.fromEntries([...inputs].map(([name,bytes])=>[name,{sha256:digest(bytes),bytes:bytes.length,dependencies:graph[name]}]))})));
  entries.set('_redirects',Buffer.from('/ /find.html 302\n/index.html /find.html 302\n'));
  entries.set('netlify.toml',Buffer.from('[build]\npublish = "."\n[functions]\ndirectory = "functions"\n'));
  entries.set('_headers',Buffer.from("/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: private, no-store\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Content-Security-Policy: "+CONTENT_SECURITY_POLICY+"\n"));
  return entries;
}
export async function readStaticPackageInputs(sourceRoot){
  const root=resolve(sourceRoot),files=new Map();
  if((await lstat(root)).isSymbolicLink())invalid('SYMLINK');
  for(const name of INPUTS){let parent=root;
    for(const part of name.split('/')){
      if(!(await readdir(parent)).includes(part))invalid('EXACT_CASE_OR_MISSING_ASSET');
      parent=join(parent,part);if((await lstat(parent)).isSymbolicLink())invalid('SYMLINK');
    }
    if(!(await lstat(parent)).isFile())invalid('NOT_REGULAR_FILE');files.set(name,await readFile(parent));
  }
  return files;
}
export async function writeStaticPackage({sourceRoot,sourceSha,output}){
  const entries=createStaticPackage({sourceSha,files:await readStaticPackageInputs(sourceRoot)});
  // Refuse an existing destination, so a prior function/secret cannot survive.
  await mkdir(output);await mkdir(join(output,'functions'));
  for(const [name,bytes] of entries){await mkdir(resolve(output,posix.dirname(name)),{recursive:true});await writeFile(join(output,name),bytes,{flag:'wx'});}
  return {files:entries.size,functions:0,sourceSha};
}
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
      // The staging branch alias is the published branch, not the protected PR
      // preview. Use the previously established, actual PR5 Deploy Preview.
      const r=await fetch('https://deploy-preview-5--getacourt-preview.netlify.app/',{redirect:'manual',signal:AbortSignal.timeout(15000)});
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
  await writeStaticPackage({sourceRoot:resolve('getacourt'),sourceSha:sha,output});
  console.log('Static Reader package prepared: no server functions, native booking UI or secrets.');
}
async function verify(){
  const result=JSON.parse(await readFile(join(process.env.RUNNER_TEMP,'get-reader-static-result.json'),'utf8'));
  if(new URL(result.deploy_url||result.deployUrl||result.url||'').origin!==RECEIVER||
    (result.site_id&&result.site_id!==SITE))throw Error('UNEXPECTED_DEPLOY_TARGET');
  const r=await fetch(RECEIVER+'/find.html',{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(r.status!==401)throw Error('NEW_DRAFT_PROTECTION_UNVERIFIED');
  console.log('Protected Reader draft anonymous HTTP 401 verified: '+RECEIVER);
  console.log('Reviewed source SHA: '+process.env.SOURCE_SHA+'; deploy ID: '+result.deploy_id);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const action=process.argv[2];
  (action==='--gate'?gate():action==='--prepare'?prepare():action==='--verify'?verify():Promise.reject(Error('UNKNOWN_ACTION')))
    .catch(error=>{console.error('PRIVATE_READER_PREVIEW_BLOCKED:',error.message);process.exitCode=1;});
}
