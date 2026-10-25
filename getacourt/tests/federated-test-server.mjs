// Loopback-only fictional browser acceptance harness. Never mounted by Netlify.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import handler from '../../netlify/functions/getacourt-search-all.mts';
if(process.env.GAC_FEDERATED_TEST_ONLY!=='1')throw new Error('FIXTURE_OPT_IN_REQUIRED');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let mode='ok',coreRequests=0;
globalThis.Netlify={env:{get:k=>({GETACOURT_APPROVED_VENUE_IDS:mode==='empty'?'':'fixture-club',GETACOURT_CORE_API_BASE:'https://core.invalid'})[k]}};
globalThis.fetch=async(url,init)=>{
  const u=new URL(url);if(u.origin!=='https://core.invalid'||u.pathname!=='/api/availability'||init.method)throw new Error('FIXTURE_EGRESS_DENIED');
  coreRequests++;
  if(mode==='auth')return new Response('{}',{status:403});
  if(mode==='failed')return new Response('{}',{status:502});
  if(mode==='slow'&&u.searchParams.get('location')==='Cascais')await new Promise(r=>setTimeout(r,500));
  if(u.searchParams.get('location')!=='Cascais')return new Response('{"slots":[]}');
  const duration=Number(u.searchParams.get('duration'));
  return new Response(JSON.stringify({slots:[{venue_id:'fixture-club',venue_name:'FICTIONAL CI CLUB',id:'court-1',name:'FICTIONAL COURT',sport:u.searchParams.get('sport'),starts_at:u.searchParams.get('date')+'T18:00:00Z',timezone:'Europe/Lisbon',duration_minutes:duration,amount_minor:duration===60?2650:3600,currency:'EUR'}]}));
};
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname==='/__fixture'){
    mode=u.searchParams.get('mode')||'ok';coreRequests=0;res.writeHead(200,{'content-type':'text/plain'});res.end('fixture-only');return;
  }
  if(u.pathname==='/__counts'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({coreRequests}));return;}
  if(u.pathname==='/api/gac/search-all'){
    if(mode==='api_failed'){res.writeHead(503);res.end('{}');return;}
    const response=await handler(new Request(u,{method:req.method}));let body=await response.text();
    if(mode==='expiring'&&response.ok){const data=JSON.parse(body);data.generatedAt=new Date(Date.now()-59000).toISOString();data.expiresAt=new Date(Date.parse(data.generatedAt)+60000).toISOString();body=JSON.stringify(data);}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(body);return;
  }
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{const body=fs.readFileSync(file);res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});res.end(body);}catch{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1',()=>console.log('FIXTURE_URL=http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
