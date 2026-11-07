// GetACourt Issue #11: strictly fixture-only permission/consent lifecycle.
// Local consent, expiry or reconnect cannot establish third-party entitlement.
// Pure snapshots; zero provider traffic, credentials, storage or real identity.
(function(root){
  "use strict";
  const ISSUED=new WeakSet(),CAPTURED=new WeakSet();
  const FIELDS=new Set(["provider","owner_type","owner_ref","connection_ref","at"]);
  const ACTIONS=new Set(["note_demo_consent","expire","withdraw","request_reconnect","switch_scope"]);
  const PROVIDERS=new Set(["playtomic","tiesports","matchi","racket_id","smashpro"]);
  const REF=/^[a-z][a-z0-9_-]{2,79}$/i;
  const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  function fields(value,allowed){
    if(!value||typeof value!=="object"||Array.isArray(value)||
       ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
      throw Error("Unsupported or sensitive input.");
    const descriptors=Object.getOwnPropertyDescriptors(value);
    for(const key of Reflect.ownKeys(descriptors))
      if(typeof key!=="string"||!allowed.has(key)||!("value" in descriptors[key]))
        throw Error("Unsupported or sensitive field.");
    return value;
  }
  function opaque(v) {
    if(typeof v!=="string"||!REF.test(v))throw Error("Opaque fixture reference required.");
    return v;
  }
  function iso(v) {
    if(typeof v!=="string"||!TIME.test(v)||!Number.isFinite(Date.parse(v)))
      throw Error("Explicit canonical UTC instant required.");
    const normalized=new Date(v).toISOString();
    if(v!==normalized&&v!==normalized.replace(".000Z","Z"))
      throw Error("Noncanonical UTC instant.");
    return normalized;
  }
  function scope(provider,owner_type,owner_ref){
    if(!PROVIDERS.has(provider))throw Error("Unknown research provider.");
    if(owner_type!=="player"&&owner_type!=="club")throw Error("Unknown owner type.");
    return {provider,owner_type,owner_ref:opaque(owner_ref)};
  }
  function issued(value){
    if(!value||typeof value!=="object"||!ISSUED.has(value))
      throw Error("Issued synthetic lifecycle state required.");
  }
  function snapshot(data) {
    const value=Object.freeze({...data});
    ISSUED.add(value);
    return value;
  }
  function create(raw) {
    const v=fields(raw,FIELDS);
    const s=scope(v.provider,v.owner_type,v.owner_ref);
    const at=iso(v.at);
    return snapshot({...s,connection_ref:opaque(v.connection_ref),
      status:"not_connected",consent_state:s.owner_type==="player"?"not_requested":"not_applicable",
      provider_authorized:false,epoch:0,last_at:at,
      audit:Object.freeze([Object.freeze({event:"created",at,epoch:0})])});
  }
  function transition(current,raw){
    issued(current);
    const v=fields(raw,new Set(["action","at","provider","owner_type","owner_ref"]));
    if(!ACTIONS.has(v.action))throw Error("Unsupported lifecycle action.");
    const at=iso(v.at);
    if(Date.parse(at)<Date.parse(current.last_at))
      throw Error("Lifecycle chronology invalid.");
    const isSwitch=v.action==="switch_scope";
    if(!isSwitch&&(v.provider!==undefined||v.owner_type!==undefined||v.owner_ref!==undefined))
      throw Error("Unsupported or sensitive scope mutation.");
    let details,consent;
    if(isSwitch){
      details=scope(v.provider,v.owner_type,v.owner_ref);
      consent=details.owner_type==="player"?"not_requested":"not_applicable";
    } else {
      if(current.owner_type!=="player")
        throw Error("Player-only demo consent lifecycle.");
      details={provider:current.provider,owner_type:current.owner_type,owner_ref:current.owner_ref};
      const previous=current.consent_state;
      switch(v.action){
        case "note_demo_consent":
          if(!["not_requested","withdrawn","expired","reconnect_requested"].includes(previous))
            throw Error("Demo consent already noted.");
          consent="noted";break;
        case "expire":
          if(previous!=="noted")throw Error("Cannot expire consent not noted.");
          consent="expired";break;
        case "request_reconnect":
          if(previous!=="expired")throw Error("Reconnect requires expired demo consent.");
          consent="reconnect_requested";break;
        case "withdraw":
          if(!["noted","expired","reconnect_requested"].includes(previous))
            throw Error("No demo consent to withdraw.");
          consent="withdrawn";break;
      }
    }
    const epoch=current.epoch+1;
    if(!Number.isSafeInteger(epoch))throw Error("Fixture epoch overflow.");
    return snapshot({...details,connection_ref:current.connection_ref,
      status:"not_connected",consent_state:consent,provider_authorized:false,
      epoch,last_at:at,audit:Object.freeze([...current.audit,Object.freeze({
        event:v.action,at,epoch
      })])});
  }
  function inspect(current){
    issued(current);
    return Object.freeze({
      status:"not_connected",consent_state:current.consent_state,
      provider:current.provider,owner_type:current.owner_type,
      provider_authorized:false,can_start_oauth:false,
      may_contact_provider:false,can_display_available_slots:false,
      token_vault_ref:null,external_revoke_performed:false,
      can_make_booking:false,provider_calls:0
    });
  }
  function capture(current,request_ref){
    issued(current);
    const item=Object.freeze({
      request_ref:opaque(request_ref),connection_ref:current.connection_ref,
      owner_ref:current.owner_ref,owner_type:current.owner_type,
      provider:current.provider,epoch:current.epoch
    });
    CAPTURED.add(item);
    return item;
  }
  function inspectLateReply(current,captured,raw){
    issued(current);
    if(!captured||typeof captured!=="object"||!CAPTURED.has(captured))
      throw Error("Issued synthetic request capture required.");
    const v=fields(raw,new Set(["provider","request_ref","epoch","outcome"]));
    if(!PROVIDERS.has(v.provider)||!REF.test(v.request_ref)||
       !Number.isSafeInteger(v.epoch)||v.epoch<0||
       !["provider_connected","available_slots","provider_error"].includes(v.outcome))
      throw Error("Malformed fixture-only completion.");
    const fresh=captured.connection_ref===current.connection_ref&&
      captured.owner_type===current.owner_type&&
      captured.owner_ref===current.owner_ref&&captured.provider===current.provider&&
      captured.epoch===current.epoch&&
      v.provider===captured.provider&&v.request_ref===captured.request_ref&&
      v.epoch===captured.epoch;
    return Object.freeze({
      accepted:false,reason:fresh?"PROVIDER_AUTHORIZATION_UNVERIFIED":"STALE_SCOPE_OR_EPOCH",
      provider_authorized:false
    });
  }
  const api=Object.freeze({create,transition,inspect,capture,inspectLateReply});
  root.GACConnectedConsentLifecycle=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
