// Strict DOM-only rendering: no innerHTML, no client-side GitHub token.
"use strict";
const el=id=>document.getElementById(id);
function node(tag,cls,text){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined)e.textContent=String(text);
  return e;
}
function appendText(parent,tag,cls,value){const e=node(tag,cls,value);parent.append(e);return e;}
function link(parent,url,text){
  if(typeof url!=="string"||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(pull\/[0-9]+|actions\/runs\/[0-9]+)$/.test(url))return;
  const a=node("a","",text);a.href=url;a.rel="noopener noreferrer";a.target="_blank";parent.append(a);
}
function section(parent,label,value){
  const s=node("section");appendText(s,"div","label",label);
  appendText(s,"p","",value);parent.append(s);
}
function card(p){
  const box=node("article","card");
  const head=node("div","cardhead");
  appendText(head,"h3","",p.name);
  appendText(head,"span","pill "+(p.ci==="success"?"good":p.ci==="running"?"warn":""),
    p.ci==="success"?"CI passed":p.ci==="running"?"CI running":"CI unverified");
  box.append(head);
  const evidence=node("div","evidence");
  appendText(evidence,"span","",p.verified?"GitHub verified":"GitHub not verified");
  appendText(evidence,"span","",p.head_sha?"SHA "+p.head_sha.slice(0,10):"SHA unknown");
  appendText(evidence,"span","",p.pr_state==="open"?(p.pr_draft?"Draft PR #":"PR #")+p.pr:"PR unverified");
  box.append(evidence);
  const progress=node("div","progress"),line=node("div","progress-row");
  appendText(line,"span","","Milestone acceptance");
  appendText(line,"strong","",p.progress_pct===null?"Not baselined":p.progress_pct+"%");
  progress.append(line);
  const track=node("div","track");
  if(p.progress_pct!==null){const bar=node("i");bar.style.width=Math.max(0,Math.min(100,p.progress_pct))+"%";track.append(bar);}
  progress.append(track);box.append(progress);
  const lanes=node("div","three");
  section(lanes,"NOW · checkpoint",p.now);
  section(lanes,"NEXT · planned",p.next);
  section(lanes,"OWNER GO · manual",p.go);
  box.append(lanes);
  const footer=node("div","cardfoot");
  link(footer,p.pr_url,"Open PR");
  link(footer,p.ci_url,"View CI");
  appendText(footer,"span","muted",p.checked_at?
    "Checked "+new Date(p.checked_at).toLocaleString():"Live status unavailable");
  box.append(footer);
  return box;
}
async function reload(){
  el("connection").textContent="Updating";
  try{
    const r=await fetch("/api/status",{cache:"no-store"});
    if(!r.ok)throw Error("status unavailable");
    const data=await r.json();
    const values=data.summary;
    el("count").textContent=values.projects;
    el("verified").textContent=values.verified;
    el("green").textContent=values.ci_success;
    el("unbaselined").textContent=values.unbaselined;
    el("updated").textContent="Generated "+new Date(data.generated_at).toLocaleString();
    const container=el("cards");container.replaceChildren(...data.projects.map(card));
    const ok=values.verified===values.projects;
    el("connection").textContent=ok?"All sources checked":"Partial / unverified";
    el("connection").className="pill "+(ok?"good":"warn");
  }catch{
    el("connection").textContent="Read unavailable";
    el("connection").className="pill warn";
    el("cards").replaceChildren(node("p","","Status data could not be retrieved. No health or progress is inferred."));
  }
}
el("reload").addEventListener("click",reload);
reload();
setInterval(reload,60_000);
