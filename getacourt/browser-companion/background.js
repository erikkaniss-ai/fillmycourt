importScripts("capture.js","observation.js","playtomic-club-catalog.js");
const VERSION="0.4.2";
// Exact owner-authorised, Team Login protected static UAT receiver. Public
// promotion remains separate; the public search-all path is not deployed yet.
const COMPARISON_PAGE="https://get-pr5-reader-uat--getacourt-preview.netlify.app/find.html";
const COMPARISON_KEY="comparisonObservation";
let generation=0,busy=false,consentPending=0,consentQueue=Promise.resolve();
// Fixed messages only: never return a browser/provider exception or credential.
const errors=Object.freeze({
  REQUEST_REJECTED:"Open GetACourt from its extension icon.",
  SOURCE_UNCLAIMED:"This club page does not offer verified client booking inventory.",
  CONNECT_REQUIRED:"Connect Playtomic once from the GetACourt extension icon on a Playtomic club page.",
  SITE_ACCESS_REQUIRED:"Allow Playtomic site access once in the GetACourt extension popup. No provider password is shared.",
  CLUB_PAGE_REQUIRED:"Open an official Playtomic /clubs/ page before connecting.",
  READ_BUSY:"A search is already running. Wait for it to finish.",
  RATE_LIMITED:"Wait 60 seconds after the previous attempt. No automatic retry runs.",
  TAB_CHANGED:"The approved tab left this club. Reconnect explicitly from the intended club.",
  TAB_ACCESS_REQUIRED:"Renew tab access using Connect and open GetACourt on the club tab.",
  CONSENT_WITHDRAWN:"Access was disconnected during the search. No offers were shared.",
  QUERY_INVALID:"Choose one valid date within the next 14 days, Padel or Tennis, and a same-day start-time range.",
  COMPACT_VIEW_REQUIRED:"Compact view failed. Resize the club window below 640 pixels before searching.",
  CHALLENGE_REQUIRED:"Complete the provider sign-in or security check personally in the club tab.",
  SCHEDULE_NOT_READY:"The selected schedule did not finish updating. No offers were shared.",
  OFFER_SECTION_MISSING:"The visible English Available courts section was not found. This layout is unsupported.",
  DATE_AMBIGUOUS:"The selected date is ambiguous. No offers were shared.",
  SPORT_AMBIGUOUS:"The selected sport is ambiguous. No offers were shared.",
  VENUE_MISSING:"The club name could not be read. No offers were shared.",
  NO_EXPANDED_OFFERS:"No matching explicit priced offer was found in the inspected subset. Other slots may exist.",
  OFFER_FORMAT_CHANGED:"The offer layout is unsupported. No availability was inferred.",
  TOO_MANY_OFFERS:"Close some expanded offers before reading.",
  COMPARISON_PREP_REQUIRED:"Search this club first, then open the GetACourt comparison from the Reader.",
  COMPARISON_EXPIRED:"The prepared observation expired. Search the club again.",
  COMPARISON_PAGE_REQUIRED:"Open the protected GetACourt personal search page in this browser, then use this extension icon.",
  COMPARISON_DELIVERY_FAILED:"The GetACourt page could not receive the observation. No offers were shared.",
  READ_FAILED:"The search could not be completed. No offers were shared."
});
const fail=code=>{throw Object.assign(new Error("Reader unavailable"),{readerCode:code});};
const unavailable=error=>{
  const code=Object.hasOwn(errors,error?.readerCode)?error.readerCode:"READ_FAILED";
  return {status:"unavailable",code,error:errors[code],version:VERSION};
};
const sourceAllowed=value=>{
  try {const u=new URL(value);return u.origin==="https://playtomic.com"&&/^\/clubs\/[a-z0-9-]+$/.test(u.pathname)&&!u.search&&!u.hash;}
  catch{return false;}
};
// Additional player-visible web origins. A supported public route is NOT
// proof of availability or an authorized account. Consent is by named domain.
const EXTRA_PROVIDERS=Object.freeze({
  tiesports:Object.freeze({origin:"https://clubs.tiesports.com/*",
    route:/^https:\/\/clubs\.tiesports\.com\/(?:en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+$/}),
  racket_id:Object.freeze({origin:"https://racket.id/*",
    route:/^https:\/\/racket\.id\/booking$/}),
  smashpro:Object.freeze({origin:"https://smashpro.pt/*",
    route:/^https:\/\/smashpro\.pt\/pt\/c\/[a-z0-9-]+$/}),
  matchi:Object.freeze({origin:"https://www.matchi.se/*",
    route:/^https:\/\/www\.matchi\.se\/facilities\/[a-z0-9_-]+$/})
});
function additionalProviderRoute(value) {
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.port||url.hash)return null;
    if([...url.searchParams.keys()].some(k=>k!=="lang"||url.hostname!=="www.matchi.se"))return null;
    const clean=url.origin+url.pathname;
    for(const [provider,rule] of Object.entries(EXTRA_PROVIDERS))
      if(rule.route.test(clean))return {provider,sourceUrl:clean,origin:rule.origin};
  }catch{}
  return null;
}
async function approveAdditional() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const parsed=additionalProviderRoute(tab?.url);
  if(!parsed)fail("CLUB_PAGE_REQUIRED");
  const granted=await chrome.permissions.contains({origins:[parsed.origin]});
  if(!granted)fail("SITE_ACCESS_REQUIRED");
  const {approvedExtraSources={}}=await chrome.storage.local.get("approvedExtraSources");
  const next={...approvedExtraSources,[parsed.provider]:parsed.sourceUrl};
  if(Object.keys(next).length>4)fail("REQUEST_REJECTED");
  await chrome.storage.local.set({approvedExtraSources:next});
  return {status:"connected",provider:parsed.provider,sourceUrl:parsed.sourceUrl,version:VERSION};
}
let extraBusy=false,racketNavigation=null;
async function autoSearchAdditionalFromGet(query) {
  const {location:area,...filters}=query||{};
  if(!queryValid(filters)||(area!==undefined&&
    (typeof area!=="string"||!area.trim()||area.length>80)))fail("QUERY_INVALID");
  if(extraBusy)fail("READ_BUSY");
  extraBusy=true;
  const epoch=generation;
  try{
    const {approvedExtraSources={}}=await chrome.storage.local.get("approvedExtraSources");
    const verified=Object.entries(approvedExtraSources).filter(([provider,url])=>
      Object.hasOwn(EXTRA_PROVIDERS,provider)&&additionalProviderRoute(url)?.provider===provider);
    const results=[];
    for(const [provider,sourceUrl] of verified.slice(0,4)){
      const result={provider,status:"unavailable",code:"READ_FAILED"};
      let createdTabId=null;
      try{
        if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
        if(!await chrome.permissions.contains({origins:[EXTRA_PROVIDERS[provider].origin]}))
          fail("SITE_ACCESS_REQUIRED");
        const key="lastAttemptExtra:"+provider;
        const previous=await chrome.storage.session.get(key);
        if(Date.now()-(previous[key]||0)<60000)fail("RATE_LIMITED");
        await chrome.storage.session.set({[key]:Date.now()});
        // The source page runs in this player's own ordinary Chrome profile.
        // No provider API, cross-account session, cookie read or remote agent.
        // An open Racket ID preview belongs to the player. Read only an exact,
        // uniquely matching existing tab; never close it or click Continue.
        const existing=provider==="racket_id"&&!area
          ?(await chrome.tabs.query({url:sourceUrl})).filter(t=>t.url===sourceUrl):[];
        if(existing.length>1)fail("TAB_CHANGED");
        const tab=existing[0]||await chrome.tabs.create({url:sourceUrl,active:false});
        if(!existing.length)createdTabId=tab.id;
        await waitForPage(tab.id);
        if(epoch!==generation)fail("CONSENT_WITHDRAWN");
        await chrome.scripting.executeScript({target:{tabId:tab.id},
          files:["visible-provider-offers.js","racket-preview.js","visible-provider-page.js"]});
        if(provider==="racket_id"&&area)racketNavigation={tabId:tab.id,epoch};
        const captured=await chrome.scripting.executeScript({target:{tabId:tab.id},
          func:async(q,epoch)=>q.location&&location.href==="https://racket.id/booking"
            ?GetACourtRacketPreview.search(q,epoch):readVisibleProviderPage(q),args:[query,epoch]});
        if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
        const observation=captured?.find(x=>x.frameId===0)?.result;
        if(observation?.readerError)fail(observation.readerError);
        if(observation?.provider!==provider||observation?.sourceUrl!==sourceUrl)
          fail("OFFER_FORMAT_CHANGED");
        // Fail closed on any unexpected field, price, origin or user identity.
        const sanitized=globalThis.GetACourtPersonalSourceObservation.validateObservation(observation);
        result.status="observed";result.observation=sanitized;delete result.code;
      }catch(error){
        result.code=Object.hasOwn(errors,error?.readerCode)?error.readerCode:"READ_FAILED";
      }finally{
        if(provider==="racket_id")racketNavigation=null;
        // This search owns only the tab it just created. Never close an existing
        // player tab; cleanup cannot replace the provider-read result or error.
        if(Number.isInteger(createdTabId)&&typeof chrome.tabs.remove==="function"){
          try{await chrome.tabs.remove(createdTabId);}catch{}
        }
      }
      results.push(result);
    }
    return {status:"partial",sources:results,version:VERSION};
  }finally{extraBusy=false;}
}

const comparisonPageAllowed=value=>{
  try{return new URL(value).href===COMPARISON_PAGE;}catch{return false;}
};
const nonceAllowed=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{24,128}$/.test(value);
function caller(sender){
  if(sender?.id!==chrome.runtime.id)fail("REQUEST_REJECTED");
  if(sender.tab&&Number.isInteger(sender.tab.id)&&sender.frameId===0&&comparisonPageAllowed(sender.url))return "page";
  if(sender.url===chrome.runtime.getURL("popup.html"))return "popup";
  if(sender.url===chrome.runtime.getURL("reader.html")&&(sender.frameId===undefined||sender.frameId===0))return "reader";
  fail("REQUEST_REJECTED");
}
function queryValid(q){
  if(!q||Object.keys(q).sort().join(",")!=="date,durationMinutes,from,sport,to"||
    !/^\d{4}-\d{2}-\d{2}$/.test(q.date)||!["Padel","Tennis"].includes(q.sport)||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.from)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(q.to)||
    q.from>q.to||![0,60,90,120].includes(q.durationMinutes))return false;
  const date=Date.parse(q.date+"T00:00:00.000Z");
  const today=Date.parse(new Date().toISOString().slice(0,10)+"T00:00:00.000Z");
  return Number.isFinite(date)&&new Date(date).toISOString().slice(0,10)===q.date&&date>=today&&date<=today+14*86400000;
}
function consentOperation(operation){
  consentPending++;
  const result=consentQueue.then(operation);
  consentQueue=result.catch(()=>{});
  return result.finally(()=>{consentPending--;});
}
async function clearConsent(){
  const {approvedTab}=await chrome.storage.session.get("approvedTab");
  await chrome.storage.local.remove("approvedSource");
  await chrome.storage.local.remove("approvedExtraSources");
  await chrome.storage.session.remove(COMPARISON_KEY);
  // Reconnecting must not reset the browser session's global attempt budget.
  await chrome.storage.session.remove("approvedTab");
  if(Number.isInteger(approvedTab)) {
    try{await chrome.tabs.sendMessage(approvedTab,{action:"cancelPersonalSearch"});}catch{}
  }
}
function comparisonObservation(value){
  const keys=["capturedAt","coverage","date","offers","provider","source","sourceFreshness","sourceUrl","sport","timezone","venue"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==keys.join(","))fail("REQUEST_REJECTED");
  let observed;
  try{observed=globalThis.GetACourtPersonalSourceObservation.validateObservation(value);}catch{fail("REQUEST_REJECTED");}
  const captured=Date.parse(observed.capturedAt);
  if(!Number.isFinite(captured)||captured>Date.now()+5000||Date.now()-captured>=60000)fail("COMPARISON_EXPIRED");
  return observed;
}
async function preparedComparison(){
  const {comparisonObservation:observed}=await chrome.storage.session.get(COMPARISON_KEY);
  if(!observed)fail("COMPARISON_PREP_REQUIRED");
  return comparisonObservation(observed);
}
async function prepareComparison(observation){
  const observed=comparisonObservation(observation);
  await chrome.storage.session.set({[COMPARISON_KEY]:observed});
  await chrome.tabs.create({url:COMPARISON_PAGE});
  return {status:"comparison_prepared",version:VERSION};
}
async function enableComparisonBridge(){
  await preparedComparison();
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!Number.isInteger(tab?.id)||!comparisonPageAllowed(tab.url))fail("COMPARISON_PAGE_REQUIRED");
  try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:["bridge-content.js"]});}
  catch{fail("COMPARISON_DELIVERY_FAILED");}
  return {status:"comparison_bridge_ready",version:VERSION};
}
async function deliverComparison(nonce,sender){
  if(!nonceAllowed(nonce))fail("REQUEST_REJECTED");
  const observed=await preparedComparison();
  let receipt;
  try{receipt=await chrome.tabs.sendMessage(sender.tab.id,{action:"deliverComparisonObservation",nonce,observation:observed});}
  catch{fail("COMPARISON_DELIVERY_FAILED");}
  // A completed browser transport is not evidence that the page accepted it.
  if(receipt?.status!=="delivered")fail("COMPARISON_DELIVERY_FAILED");
  await chrome.storage.session.remove(COMPARISON_KEY);
  return {status:"comparison_delivered",version:VERSION};
}
async function disconnect(){
  generation++;
  return consentOperation(async()=>{
    await clearConsent();
  return {status:"disconnected",version:VERSION};
  });
}
async function approve(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const u=new URL(tab?.url||"about:blank"),source=u.origin+u.pathname;
  if(!sourceAllowed(source))fail("CLUB_PAGE_REQUIRED");
  generation++;
  return consentOperation(async()=>{
    await clearConsent();
    await chrome.storage.local.set({approvedSource:source});
    await chrome.storage.session.set({approvedTab:tab.id});
    return {status:"connected",sourceUrl:source,version:VERSION};
  });
}
// Chrome stores the player's native Playtomic session. No cookies, passwords or
// tokens are read or copied into GetACourt. The remembered club URL is not auth.
async function waitForPage(tabId) {
  const tab=await chrome.tabs.get(tabId);
  if(tab.status==="complete")return;
  await new Promise((resolve,reject)=>{
    let done=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(deadline);
      chrome.tabs.onUpdated.removeListener(onUpdate);error?reject(error):resolve();};
    const onUpdate=(id,change)=>{if(id===tabId&&change.status==="complete")finish();};
    const deadline=setTimeout(()=>finish(Error("TAB_LOAD_TIMEOUT")),15000);
    chrome.tabs.onUpdated.addListener(onUpdate);
    chrome.tabs.get(tabId).then(t=>{if(t.status==="complete")finish();}).catch(finish);
  });
}
async function ensurePersonalProviderTab() {
  const {approvedSource}=await chrome.storage.local.get("approvedSource");
  if(!sourceAllowed(approvedSource))fail("CONNECT_REQUIRED");
  let hasHostAccess=false;
  try{hasHostAccess=await chrome.permissions.contains({origins:["https://playtomic.com/*"]});}catch{}
  if(!hasHostAccess)fail("SITE_ACCESS_REQUIRED");
  const {approvedTab}=await chrome.storage.session.get("approvedTab");
  if(Number.isInteger(approvedTab)){
    try{
      const tab=await chrome.tabs.get(approvedTab);
      if(new URL(tab.url).origin+new URL(tab.url).pathname===approvedSource){
        await waitForPage(tab.id);return tab.id;
      }
    }catch{}
  }
  // Opens a fresh normal provider page in the player's EXISTING Chrome profile.
  // Native first-party login cookies remain browser-owned and are never read.
  let created;
  try{
    created=await chrome.tabs.create({url:approvedSource,active:false});
    await chrome.windows.create({tabId:created.id,type:"normal",width:480,height:850,focused:false});
    await chrome.storage.session.set({approvedTab:created.id});
    await waitForPage(created.id);
    return created.id;
  }catch{fail("TAB_ACCESS_REQUIRED");}
}
let autoBusy=false;
async function autoSearchFromGet(query) {
  if(!queryValid(query))fail("QUERY_INVALID");
  if(autoBusy)fail("READ_BUSY");
  autoBusy=true;
  const epoch=generation;
  try{
    await ensurePersonalProviderTab();
    if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
    return await runSearch(query);
  }finally{autoBusy=false;}
}

// A single Playtomic player account/Chrome site grant supports bounded
// read-only searches at up to FOUR independently reviewed first-party clubs.
// No club-admin feed, API, hidden endpoints, authentication export or
// unattended polling. Temporary browser tabs/windows are cleaned afterward.
function multiPlaytomicQueryValid(query){
  if(!query||typeof query!=="object"||Array.isArray(query)||
     Object.keys(query).sort().join(",")!=="date,durationMinutes,from,location,sport,to"||
     typeof query.location!=="string"||query.location.length<1||query.location.length>80)return false;
  const {location,...filters}=query;
  return queryValid(filters)&&!!location.trim();
}
async function autoSearchPlaytomicClubsFromGet(query){
  if(!multiPlaytomicQueryValid(query))fail("QUERY_INVALID");
  if(busy||autoBusy||consentPending)fail("READ_BUSY");
  autoBusy=true;
  const epoch=generation;
  let tempWindow=null,tempTab=null;
  try{
    const {approvedSource}=await chrome.storage.local.get("approvedSource");
    if(!sourceAllowed(approvedSource))fail("CONNECT_REQUIRED");
    if(!await chrome.permissions.contains({origins:["https://playtomic.com/*"]}))
      fail("SITE_ACCESS_REQUIRED");
    const registry=globalThis.GetACourtPlaytomicClubCatalog;
    if(!registry||typeof registry.matching!=="function")fail("READ_FAILED");
    const clubs=registry.matching(query);
    if(!Array.isArray(clubs)||clubs.length>4)fail("READ_FAILED");
    if(!clubs.length)return {status:"partial",sources:[],coverage:"no_reviewed_club_in_area",version:VERSION};
    if(clubs.some(c=>!sourceAllowed(c.sourceUrl)))fail("CLUB_PAGE_REQUIRED");
    const {lastAttempt=0}=await chrome.storage.session.get("lastAttempt");
    if(Date.now()-lastAttempt<60000)fail("RATE_LIMITED");
    await chrome.storage.session.set({lastAttempt:Date.now()});
    const providerQuery={date:query.date,sport:query.sport,from:query.from,to:query.to,
      durationMinutes:query.durationMinutes};
    const results=[];
    for(const club of clubs){
      if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
      const result={provider:"playtomic",sourceUrl:club.sourceUrl,
        status:"unavailable",code:"READ_FAILED"};
      try{
        let tab;
        // Only our OWN temporary worker window is compacted or closed.
        if(tempWindow===null){
          tab=await chrome.tabs.create({url:club.sourceUrl,active:false});
          tempTab=tab.id;
          const window=await chrome.windows.create({
            tabId:tab.id,type:"normal",width:480,height:850,focused:false
          });
          tempWindow=window.id;
        }else{
          tab=await chrome.tabs.create({
            url:club.sourceUrl,active:false,windowId:tempWindow
          });
        }
        await waitForPage(tab.id);
        if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
        await chrome.scripting.executeScript({
          target:{tabId:tab.id},files:["capture.js","search.js"]
        });
        const rows=await chrome.scripting.executeScript({
          target:{tabId:tab.id},func:async q=>searchPlaytomic(q),args:[providerQuery]
        });
        if(epoch!==generation||consentPending)fail("CONSENT_WITHDRAWN");
        const observed=rows?.find(x=>x.frameId===0)?.result;
        if(observed?.readerError)fail(observed.readerError);
        if(!observed||observed.sourceUrl!==club.sourceUrl||
           observed.date!==query.date||observed.sport!==query.sport)
          fail("SCHEDULE_NOT_READY");
        result.observation=globalThis.GetACourtPersonalSourceObservation.validateObservation(observed);
        result.status="observed";delete result.code;
      }catch(error){
        result.code=Object.hasOwn(errors,error?.readerCode)?error.readerCode:"READ_FAILED";
      }
      results.push(result);
      // One failure must not blank another club's genuine observation.
    }
    return {status:"partial",sources:results,
      coverage:"bounded_reviewed_club_pages_only",version:VERSION};
  }finally{
    if(Number.isInteger(tempWindow)&&typeof chrome.windows.remove==="function"){
      try{await chrome.windows.remove(tempWindow);}catch{}
    }else if(Number.isInteger(tempTab)&&typeof chrome.tabs.remove==="function"){
      try{await chrome.tabs.remove(tempTab);}catch{}
    }
    autoBusy=false;
  }
}

async function autoStatus() {
  const {approvedSource}=await chrome.storage.local.get("approvedSource");
  let hasHostAccess=false;
  try{hasHostAccess=await chrome.permissions.contains({origins:["https://playtomic.com/*"]});}catch{}
  return {status:sourceAllowed(approvedSource)&&hasHostAccess?"configured":"not_configured",
    sourceUrl:sourceAllowed(approvedSource)?approvedSource:null,version:VERSION,
    note:"Provider login status is checked only on normal provider UI search."};
}
async function openReader(){
  await chrome.tabs.create({url:chrome.runtime.getURL("reader.html")});
  return {status:"opened",version:VERSION};
}
async function approvedTab(){
  const {approvedSource}=await chrome.storage.local.get("approvedSource");
  const {approvedTab}=await chrome.storage.session.get("approvedTab");
  if(!sourceAllowed(approvedSource)||!Number.isInteger(approvedTab))fail("CONNECT_REQUIRED");
  let tab,u;
  try{tab=await chrome.tabs.get(approvedTab);u=new URL(tab.url);}catch{fail("TAB_ACCESS_REQUIRED");}
  if(u.origin+u.pathname!==approvedSource)fail("TAB_CHANGED");
  return {tab,source:approvedSource};
}
async function status(){
  const {approvedSource}=await chrome.storage.local.get("approvedSource");
  const {approvedTab}=await chrome.storage.session.get("approvedTab");
  return {status:!consentPending&&sourceAllowed(approvedSource)&&Number.isInteger(approvedTab)?"connected":"disconnected",
    sourceUrl:sourceAllowed(approvedSource)?approvedSource:null,version:VERSION};
}
async function runSearch(query){
  if(consentPending)fail("CONSENT_WITHDRAWN");
  if(busy)fail("READ_BUSY");
  busy=true;const epoch=generation;
  try{
    const {lastAttempt=0}=await chrome.storage.session.get("lastAttempt");
    if(Date.now()-lastAttempt<60000)fail("RATE_LIMITED");
    const {tab,source}=await approvedTab();
    await chrome.storage.session.set({lastAttempt:Date.now()});
    if(epoch!==generation)fail("CONSENT_WITHDRAWN");
    if(query){
      // The Search button discloses moving only this approved tab to compact view.
      // Other tabs/windows are never enumerated, resized or closed.
      try{
        const window=await chrome.windows.get(tab.windowId);
        if(!window||window.width>640)
          await chrome.windows.create({tabId:tab.id,type:"normal",width:480,height:850,focused:false});
      }catch{fail("COMPACT_VIEW_REQUIRED");}
    }
    if(epoch!==generation)fail("CONSENT_WITHDRAWN");
    let results;
    try{
      if(query){
        await chrome.scripting.executeScript({target:{tabId:tab.id},files:["capture.js","search.js"]});
        if(epoch!==generation)fail("CONSENT_WITHDRAWN");
        results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async q=>searchPlaytomic(q),args:[query]});
      }else results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capturePlaytomic});
    }catch(error){
      if(epoch!==generation||error?.readerCode==="CONSENT_WITHDRAWN")fail("CONSENT_WITHDRAWN");
      fail("TAB_ACCESS_REQUIRED");
    }
    if(epoch!==generation)fail("CONSENT_WITHDRAWN");
    const result=results?.find(r=>r.frameId===0)?.result;
    if(result?.readerError)fail(result.readerError);
    if(!result)fail("READ_FAILED");
    const current=await approvedTab();
    if(epoch!==generation)fail("CONSENT_WITHDRAWN");
    if(current.tab.id!==tab.id||result.sourceUrl!==source)fail("TAB_CHANGED");
    if(query&&(result.date!==query.date||result.sport!==query.sport))fail("SCHEDULE_NOT_READY");
    return {status:"observed",observation:result,version:VERSION};
  }finally{busy=false;}
}
async function handle(message,sender){
  // Only this active task's exact Racket tab can ask whether its existing
  // grant is still valid. Content scripts do not have chrome.permissions.
  if(message?.action==="racketNavigationConsent"){
    const active=racketNavigation;
    if(!active||Object.keys(message).sort().join(",")!=="action,epoch"||
      sender?.id!==chrome.runtime.id||sender.frameId!==0||
      sender.url!=="https://racket.id/booking"||sender.tab?.id!==active.tabId||
      message.epoch!==active.epoch||generation!==active.epoch||consentPending)
      return {allowed:false};
    const {approvedExtraSources={}}=await chrome.storage.local.get("approvedExtraSources");
    const permitted=await chrome.permissions.contains({origins:["https://racket.id/*"]});
    return {allowed:permitted&&approvedExtraSources.racket_id==="https://racket.id/booking"&&
      racketNavigation===active&&generation===active.epoch&&!consentPending};
  }
  const role=caller(sender);
  const actionKeys=Object.freeze({status:["action"],revoke:["action"],approve:["action"],open:["action"],read:["action"],
    search:["action","query"],autoSearchFromGet:["action","query"],autoSearchPlaytomicClubsFromGet:["action","query"],autoStatus:["action"],
    autoSearchAdditionalFromGet:["action","query"],approveAdditional:["action"],
    showClub:["action"],prepareComparison:["action","observation"],
    enableComparisonBridge:["action"],pageBridgeReady:["action","nonce"]});
  if(!message||typeof message!=="object"||Array.isArray(message)||!Object.hasOwn(actionKeys,message.action)||
    Object.keys(message).some(k=>!actionKeys[message.action].includes(k)))fail("REQUEST_REJECTED");
  if(message.action==="status")return status();
  if(message.action==="autoStatus"&&role==="page")return autoStatus();
  if(message.action==="autoSearchFromGet"&&role==="page")return autoSearchFromGet(message.query);
  if(message.action==="autoSearchPlaytomicClubsFromGet"&&role==="page")return autoSearchPlaytomicClubsFromGet(message.query);
  if(message.action==="autoSearchAdditionalFromGet"&&role==="page")return autoSearchAdditionalFromGet(message.query);
  if(message.action==="approveAdditional"&&role==="popup")return approveAdditional();
  if(message.action==="revoke")return disconnect();
  if(message.action==="approve"&&role==="popup"){
    const result=await approve();await openReader();return result;
  }
  if(message.action==="open"&&role==="popup")return openReader();
  if(message.action==="read"&&role==="reader")return runSearch();
  if(message.action==="search"&&role==="reader"){
    if(!queryValid(message.query))fail("QUERY_INVALID");
    return runSearch(message.query);
  }
  if(message.action==="showClub"&&role==="reader"){
    const {tab}=await approvedTab();
    await chrome.tabs.update(tab.id,{active:true});
    await chrome.windows.update(tab.windowId,{focused:true});
    return {status:"opened",version:VERSION};
  }
  if(message.action==="prepareComparison"&&role==="reader")return prepareComparison(message.observation);
  if(message.action==="enableComparisonBridge"&&role==="popup")return enableComparisonBridge();
  if(message.action==="pageBridgeReady"&&role==="page")return deliverComparison(message.nonce,sender);
  fail("REQUEST_REJECTED");
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  handle(message,sender).then(reply).catch(error=>reply(unavailable(error)));return true;
});
