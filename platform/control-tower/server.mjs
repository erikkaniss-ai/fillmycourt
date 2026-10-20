// Local-only Control Tower read service. Hosting/auth requires separate GO.
// GitHub token is used ONLY server-side. Never send it to browser or logs.
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join,dirname} from "node:path";
import {PROJECTS,portfolio,classifyRequiredCI} from "./model.mjs";

const ROOT=dirname(fileURLToPath(import.meta.url));
const FILES={"/": ["public/index.html","text/html; charset=utf-8"],
  "/app.js":["public/app.js","text/javascript; charset=utf-8"],
  "/style.css":["public/style.css","text/css; charset=utf-8"]};
const HEADERS={
  "Cache-Control":"no-store",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Frame-Options":"DENY",
  "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};
const MAX_AGE_MS=60_000;
let cached=null,until=0,pending=null;
const token=process.env.CONTROL_TOWER_GITHUB_READ_TOKEN || "";

export function safeGithubUrl(repo,path) {
  if(!PROJECTS.some(p=>p.repo===repo)) throw Error("Repo not allowlisted");
  return "https://api.github.com/repos/" + repo + path;
}
async function github(repo,path) {
  if(!token)throw Error("GitHub read token missing");
  const response=await fetch(safeGithubUrl(repo,path),{
    headers:{"Accept":"application/vnd.github+json",
      "Authorization":"Bearer " + token,
      "X-GitHub-Api-Version":"2022-11-28"},
    signal:AbortSignal.timeout(7000)
  });
  if(!response.ok)throw Error("GitHub read failed");
  return response.json();
}
async function observe(c) {
  let pr;
  try {
    pr=await github(c.repo,"/pulls/" + c.pr);
    if(!pr || !pr.head || !/^[a-f0-9]{40}$/.test(pr.head.sha) ||
      pr.number!==c.pr || pr.state!=="open" && pr.state!=="closed")
      throw Error("Invalid PR response");
  } catch {
    // A failed PR read is not an engineering failure; mark GitHub unverified.
    return {verified:false};
  }
  // Preserve the verified PR state when only Actions permission/network fails.
  let classification={ci:"unverified",ci_url:null,ci_evidence:[]};
  if(c.required_ci?.length) {
    const queries=[
      "/actions/runs?event=pull_request&head_sha="+encodeURIComponent(pr.head.sha)+"&per_page=100",
      "/actions/runs?event=pull_request&branch="+encodeURIComponent(pr.head.ref)+"&per_page=100"
    ];
    const reads=await Promise.allSettled(queries.map(path=>github(c.repo,path)));
    const runs=new Map();
    for(const read of reads) {
      if(read.status!=="fulfilled")continue;
      for(const run of read.value.workflow_runs||[]) {
        if(Number.isSafeInteger(run.id))runs.set(run.id,run);
      }
    }
    classification=classifyRequiredCI(c.required_ci,[...runs.values()],pr.head.sha,c.pr);
  }
  return {verified:true,checked_at:new Date().toISOString(),
    head_sha:pr.head.sha,pr_state:pr.state,pr_draft:pr.draft,
    ...classification};
}
export async function readPortfolio() {
  const now=Date.now();
  if(cached&&now<until)return cached;
  if(pending)return pending;
  pending=(async()=>{
    const observed=Object.fromEntries(await Promise.all(PROJECTS.map(async c=>
      [c.id,await observe(c)])));
    const value=portfolio(PROJECTS,observed,new Date().toISOString());
    cached=value;until=Date.now()+MAX_AGE_MS;
    return value;
  })();
  try{return await pending;}finally{pending=null;}
}
function respond(res,status,body,type="application/json; charset=utf-8") {
  res.writeHead(status,{...HEADERS,"Content-Type":type});
  res.end(body);
}
export function startServer(port=Number(process.env.PORT||4178)) {
  const server=createServer(async(req,res)=>{
    const path=(req.url||"/").split("?")[0];
    if(req.method!=="GET"){respond(res,405,JSON.stringify({error:"method_not_allowed"}));return;}
    if(path==="/api/status"){
      const data=await readPortfolio();
      respond(res,200,JSON.stringify(data));return;
    }
    const item=FILES[path];
    if(!item){respond(res,404,JSON.stringify({error:"not_found"}));return;}
    try {
      const file=await readFile(join(ROOT,item[0]));
      respond(res,200,file,item[1]);
    }catch{respond(res,503,JSON.stringify({error:"asset_unavailable"}));}
  });
  // Loopback only; private remote hosting is deliberately not activated.
  server.listen(port,"127.0.0.1");
  return server;
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])
  startServer();
