importScripts("capture.js","observation.js");
const VERSION="0.2.2";
const COMPARISON_PAGE="https://getacourt.com/search-all.html";
const COMPARISON_KEY="comparisonObservation";
let generation=0,busy=false,consentPending=0,consentQueue=Promise.resolve();
// Fixed messages only: never return a browser/provider exception or credential.
const errors=Object.freeze({
  REQUEST_REJECTED:"Open GetACourt from its extension icon.",
  CONNECT_REQUIRED:"Open the intended Playtomic club, click the GetACourt icon, then Connect and open GetACourt.",
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
  COMPARISON_PAGE_REQUIRED:"Open GetACourt Search across sources in this browser, then use this extension icon.",
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
  try{await chrome.tabs.sendMessage(sender.tab.id,{action:"deliverComparisonObservation",nonce,observation:observed});}
  catch{fail("COMPARISON_DELIVERY_FAILED");}
  // The page-specific listener acknowledges delivery before this single-use copy
  // is cleared. It is never placed in a URL, clipboard or persistent storage.
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
  const role=caller(sender);
  const actionKeys=Object.freeze({status:["action"],revoke:["action"],approve:["action"],open:["action"],read:["action"],
    search:["action","query"],showClub:["action"],prepareComparison:["action","observation"],
    enableComparisonBridge:["action"],pageBridgeReady:["action","nonce"]});
  if(!message||typeof message!=="object"||Array.isArray(message)||!Object.hasOwn(actionKeys,message.action)||
    Object.keys(message).some(k=>!actionKeys[message.action].includes(k)))fail("REQUEST_REJECTED");
  if(message.action==="status")return status();
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
