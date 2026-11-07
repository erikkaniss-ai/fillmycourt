// GetACourt / FillMyCourt personal provider account laboratory.
// Pure, transport-free test preparation. The account owner may sign into an
// OFFICIAL provider app independently; that does not authorize our API.
(function(root) {
  "use strict";
  const PROVIDERS=Object.freeze({
    playtomic:Object.freeze({
      id:"playtomic",name:"Playtomic",player_delegated_oauth:"unverified",
      availability_read:"unverified",clubs_api_is_player_auth:false,
      public_evidence:"club_read_only_api_and_certified_partner_program"
    }),
    tiesports:Object.freeze({
      id:"tiesports",name:"TiePlayer / TieSports",player_delegated_oauth:"unverified",
      availability_read:"unverified",clubs_api_is_player_auth:false,
      public_evidence:"TieManager_club_open_api_and_webhooks"
    })
  });
  const FIELDS=new Set([
    "provider","participant_ref","consent_ref","test_ref","consented_at",
    "owner_permitted_personal_testing"
  ]);
  const ISSUED=new WeakSet();
  const iso=(v)=>{
    if(typeof v!=="string"||!v.endsWith("Z")||!Number.isFinite(Date.parse(v)))
      throw Error("Valid UTC timestamp required.");
    const date=new Date(v).toISOString();
    if(v!==date && v!==date.replace(".000Z","Z"))
      throw Error("Canonical UTC timestamp required.");
    return date;
  };
  const opaque=(v)=>typeof v==="string"&&/^[a-z][a-z0-9_-]{2,79}$/i.test(v);
  const checked=(plan)=>{
    if(!plan||typeof plan!=="object"||!ISSUED.has(plan))
      throw Error("Issued test plan required.");
  };
  function supportedProviders(){return Object.values(PROVIDERS);}
  function createPersonalTestPlan(input={}) {
    if(!input||typeof input!=="object"||Array.isArray(input))
      throw Error("Unsupported or sensitive input.");
    for(const key of Reflect.ownKeys(input)){
      if(!FIELDS.has(key))throw Error("Unsupported or sensitive field: "+String(key));
    }
    const provider=PROVIDERS[input.provider];
    if(!provider)throw Error("Unknown provider.");
    if(input.owner_permitted_personal_testing!==true)
      throw Error("Explicit account owner consent required.");
    for(const key of ["participant_ref","consent_ref","test_ref"]){
      if(!opaque(input[key]))throw Error("Opaque internal reference required.");
    }
    const at=iso(input.consented_at);
    const plan=Object.freeze({
      provider:provider.id,participant_ref:input.participant_ref,
      consent_ref:input.consent_ref,test_ref:input.test_ref,
      consented_at:at,status:"awaiting_official_provider_authorization",
      user_consented:true,provider_authorized:false,
      can_start_oauth:false,can_retrieve_account_data:false,
      can_show_live_slots:false,credentials_collected:false,
      external_calls:0,
      allowed_activity:Object.freeze(["owner_sign_in_directly_in_official_app"]),
      required_next_gate:"PROVIDER_PLAYER_DELEGATION_UNVERIFIED"
    });
    ISSUED.add(plan);
    return plan;
  }
  function evaluateReadiness(plan){
    checked(plan);
    return Object.freeze({
      state:"blocked",
      reason:plan.status==="user_consent_withdrawn"?
        "USER_CONSENT_WITHDRAWN":"PROVIDER_PLAYER_DELEGATION_UNVERIFIED",
      owner_consented:plan.status!=="user_consent_withdrawn",
      requires_provider_contract:true,
      provider_authorized:false,
      may_open_provider_oauth_redirect:false,
      may_observe_private_session:false,
      may_call_undocumented_api:false,
      may_show_live_slots:false
    });
  }
  function withdrawPersonalTestConsent(plan,at){
    checked(plan);
    if(plan.status==="user_consent_withdrawn")
      throw Error("Test consent already withdrawn.");
    const timestamp=iso(at);
    if(Date.parse(timestamp)<Date.parse(plan.consented_at))
      throw Error("Consent withdrawal chronology invalid.");
    const result=Object.freeze({
      provider:plan.provider,participant_ref:plan.participant_ref,
      consent_ref:plan.consent_ref,test_ref:plan.test_ref,
      consented_at:plan.consented_at,withdrawn_at:timestamp,
      status:"user_consent_withdrawn",user_consented:false,
      provider_authorized:false,external_revoke_performed:false,
      can_start_oauth:false,can_retrieve_account_data:false,
      can_show_live_slots:false,credentials_collected:false,
      external_calls:0,allowed_activity:Object.freeze([])
    });
    ISSUED.add(result);
    return result;
  }
  const api=Object.freeze({
    supportedProviders,createPersonalTestPlan,evaluateReadiness,
    withdrawPersonalTestConsent
  });
  root.GACProviderAccountTestLab=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
