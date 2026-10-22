// GetACourt Issue #11 — isolated, ephemeral, fixture-only Connected Accounts UI.
// No network, OAuth, tokens, storage, real provider integration or booking actions.
// This page is NOT linked from the shipping consumer application.
(() => {
  "use strict";
  const supply=globalThis.GACProviderSupplyContract;
  if(!supply)throw Error("Synthetic supply contract is required.");
  const providers=supply.registry();
  const state={provider:"playtomic",audience:"player",consent:"not_requested"};
  const byId=id=>document.getElementById(id);
  const providerHost=byId("providers");
  const status=byId("status");
  const description=byId("description");
  const rights=byId("rights");
  const next=byId("next");
  const consentBtn=byId("consentButton");
  const revokeBtn=byId("withdrawButton");
  const result=byId("result");
  const requestLog=byId("requestLog");
  const allProviders=new Set(providers.map(p=>p.id));
  const audited=Object.freeze([
    "GetACourt sign-in is not a provider account permission.",
    "Provider-side written authorization and scopes have not been verified.",
    "A club's bookings.read does not prove complete available court inventory.",
    "There is no consented live account, token, licensed availability feed or booking endpoint."
  ]);
  let renderCount=0;

  function selectProvider(id) {
    if(!allProviders.has(id))return;
    state.provider=id;
    state.consent="not_requested";
    render();
  }
  function selectAudience(type) {
    if(type!=="player"&&type!=="club")return;
    state.audience=type;
    state.consent="not_requested";
    render();
  }
  function makeButton(provider) {
    const b=document.createElement("button");
    b.type="button";
    b.className="provider";
    b.dataset.provider=provider.id;
    const name=document.createElement("span");
    name.className="providerName";
    name.textContent=({
      playtomic:"Playtomic",tiesports:"TieSports / TiePlayer",
      matchi:"MATCHi",racket_id:"Racket ID",smashpro:"SmashPro"
    })[provider.id];
    const badge=document.createElement("span");
    badge.className="providerBadge";
    badge.textContent="Not verified";
    b.append(name,badge);
    b.addEventListener("click",()=>selectProvider(provider.id));
    return b;
  }
  for(const p of providers)providerHost.append(makeButton(p));

  const titles={
    playtomic:"Playtomic",
    tiesports:"TieSports / TiePlayer",matchi:"MATCHi",
    racket_id:"Racket ID",smashpro:"SmashPro"
  };
  function listTo(host,items) {
    host.replaceChildren();
    for(const item of items){
      const li=document.createElement("li");
      li.textContent=item;
      host.append(li);
    }
  }
  function createResult() {
    const now=new Date();
    const nowIso=now.toISOString();
    const search={
      requester_ref:state.audience==="player"?"demo-player-01":"demo-operator-01",
      request_ref:"demo-search-01",
      starts_at:new Date(now.getTime()+3600000).toISOString(),
      ends_at:new Date(now.getTime()+7200000).toISOString(),
      now:nowIso
    };
    const planned=state.audience==="player"
      ? supply.planExternalAccount({
          provider:state.provider,user_ref:"demo-player-01",consent_ref:"demo-consent-01",
          consented_at:nowIso
        })
      : supply.planProviderSupply({
          provider:state.provider,organization_ref:"demo-organization-01",
          club_ref:"demo-club-01",research_ref:"demo-research-01",created_at:nowIso
        });
    if(state.audience==="club"){
      search.organization_ref="demo-organization-01";
      search.club_ref="demo-club-01";
    }
    return supply.searchAvailableSlots(planned,search);
  }
  function render(){
    renderCount++;
    for(const b of providerHost.querySelectorAll("button")){
      const selected=b.dataset.provider===state.provider;
      b.setAttribute("aria-pressed",String(selected));
      b.classList.toggle("selected",selected);
    }
    byId("playerMode").setAttribute("aria-pressed",String(state.audience==="player"));
    byId("clubMode").setAttribute("aria-pressed",String(state.audience==="club"));
    byId("playerMode").classList.toggle("selected",state.audience==="player");
    byId("clubMode").classList.toggle("selected",state.audience==="club");
    byId("providerTitle").textContent=titles[state.provider];
    byId("modeLabel").textContent=state.audience==="player"?"Player account":"Club supply";
    const label=state.audience==="club"
      ? "Club-owned supply rights remain unverified."
      : state.consent==="noted"
        ? "Demo consent noted locally. Provider account NOT connected."
        : state.consent==="withdrawn"
          ? "Demo consent withdrawn. Provider account NOT connected."
          : "Provider account NOT connected.";
    status.textContent=label;
    description.textContent=state.audience==="club"
      ? "A venue may separately obtain licensed read access for its own courts. This is not permission to use a player's third-party account."
      : "Connecting an external account requires an official player-delegated authorization method and verified provider scopes. This screen cannot start one.";
    listTo(rights,state.audience==="club"?[
      audited[1],audited[2],audited[3]
    ]:audited);
    listTo(next,state.audience==="club"?[
      "Confirm the named club's authority, venue/court coverage and redistribution license.",
      "Document freshness, price rights, rate limits and retention.",
      "Obtain separate approval before any official provider traffic."
    ]:[
      "Confirm official provider support for player delegation and callback scopes.",
      "Collect explicit consent in an approved future real flow, without passwords in GetACourt.",
      "On expiration or revocation, clear private sessions and deny supply requests."
    ]);
    const outcome=createResult();
    result.textContent="Availability: "+outcome.status.toUpperCase()+
      " · "+outcome.slots.length+" slots · no live source checked";
    requestLog.textContent="Provider HTTP requests: "+outcome.provider_requests+
      " · Booking actions: 0 · Persistent storage: none";
    consentBtn.disabled=state.audience!=="player"||state.consent==="noted";
    revokeBtn.disabled=state.audience!=="player"||state.consent!=="noted";
    byId("scopeMessage").textContent=state.audience==="club"
      ? "A player's consent cannot authorize club data access."
      : "Demo-only consent is not real OAuth, provider authorization or a saved account.";
    document.documentElement.dataset.demoRender=String(renderCount);
  }
  byId("playerMode").addEventListener("click",()=>selectAudience("player"));
  byId("clubMode").addEventListener("click",()=>selectAudience("club"));
  consentBtn.addEventListener("click",()=>{
    if(state.audience!=="player"||state.consent==="noted")return;
    state.consent="noted";render();
  });
  revokeBtn.addEventListener("click",()=>{
    if(state.audience!=="player"||state.consent!=="noted")return;
    state.consent="withdrawn";render();
  });
  render();
})();