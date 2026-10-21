// GetACourt Issue #11 — pure, fictional connector contract; no transport,
// account linking, provider authentication, booking, storage, or live supply.
// A GetACourt player identity is not a third-party provider entitlement.
// A club's booking-event permissions are not available-court inventory rights.
(function(root) {
  "use strict";

  const ISSUED=new WeakSet();
  const REF=/^[a-z][a-z0-9_-]{2,79}$/i;
  const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
  const MAX_WINDOW=14*24*60*60*1000;
  const SLOT_SCHEMA=Object.freeze([
    "source","club","court","starts_at","timezone","price",
    "booking_mode","last_verified_at","data_freshness","deeplink","entitlement"
  ]);
  const PROVIDERS=Object.freeze([
    Object.freeze({id:"playtomic",authority_basis:"club_bookings_only"}),
    Object.freeze({id:"tiesports",authority_basis:"club_api_marketing_only"}),
    Object.freeze({id:"matchi",authority_basis:"public_api_catalogue_scope_unverified"}),
    Object.freeze({id:"racket_id",authority_basis:"contract_discovery_required"}),
    Object.freeze({id:"smashpro",authority_basis:"contract_discovery_required"})
  ]);
  const byId=Object.freeze(Object.fromEntries(PROVIDERS.map(p=>[p.id,p])));

  function plain(input,allowed) {
    if(!input||typeof input!=="object"||Array.isArray(input)||
       ![Object.prototype,null].includes(Object.getPrototypeOf(input)))
      throw Error("Unsupported or sensitive input.");
    const descriptors=Object.getOwnPropertyDescriptors(input);
    for(const key of Reflect.ownKeys(descriptors)) {
      if(typeof key!=="string"||!allowed.includes(key)||
         !("value" in descriptors[key]))
        throw Error("Unsupported or sensitive field.");
    }
    return input;
  }
  function opaque(value) {
    if(typeof value!=="string"||!REF.test(value))
      throw Error("Opaque fixture reference required.");
    return value;
  }
  function iso(value) {
    if(typeof value!=="string"||!UTC.test(value)||!Number.isFinite(Date.parse(value)))
      throw Error("A UTC instant with Z offset is required.");
    const normalized=new Date(value).toISOString();
    if(value!==normalized && value!==normalized.replace(".000Z","Z"))
      throw Error("Noncanonical UTC instant.");
    return normalized;
  }
  function providerDefinition(id) {
    const p=Object.hasOwn(byId,id)?byId[id]:null;
    if(!p)throw Error("Unknown provider.");
    return p;
  }
  function registry() {
    return PROVIDERS.map(p=>Object.freeze({
      id:p.id,authority_basis:p.authority_basis,
      player_delegation:"unverified",
      available_inventory_license:"unverified",
      provider_booking_write:"not_authorized"
    }));
  }
  function planExternalAccount(raw) {
    const input=plain(raw,["provider","user_ref","consent_ref","consented_at"]);
    const p=providerDefinition(input.provider);
    const out=Object.freeze({
      kind:"external_player_account",owner_type:"player",
      provider:p.id,user_ref:opaque(input.user_ref),
      consent_ref:opaque(input.consent_ref),
      consented_at:iso(input.consented_at),
      status:"not_connected",provider_authorized:false,
      token_vault_ref:null,provider_account_identifier:null,
      authorized_capabilities:Object.freeze([])
    });
    ISSUED.add(out);
    return out;
  }
  function planProviderSupply(raw) {
    const input=plain(raw,[
      "provider","organization_ref","club_ref","research_ref","created_at"
    ]);
    const p=providerDefinition(input.provider);
    const out=Object.freeze({
      kind:"provider_supply_connection",owner_type:"club",
      provider:p.id,
      organization_ref:opaque(input.organization_ref),
      club_ref:opaque(input.club_ref),
      research_ref:opaque(input.research_ref),
      created_at:iso(input.created_at),
      status:"rights_unverified",provider_authorized:false,
      verified_inventory_scope:false,can_make_provider_requests:false,
      token_vault_ref:null,authorized_capabilities:Object.freeze([])
    });
    ISSUED.add(out);
    return out;
  }
  function slotFields() {return Object.freeze([...SLOT_SCHEMA]);}

  // Future authorised adapters must provide evidence separately. These
  // unapproved plans cannot call a provider or claim free slots, even if
  // user consent, a rate window, a UI fixture, or club booking data exists.
  function searchAvailableSlots(plan,raw={}) {
    if(!plan||typeof plan!=="object"||!ISSUED.has(plan))
      throw Error("Issued connection plan required.");
    const input=plain(raw,[
      "requester_ref","request_ref","organization_ref","club_ref",
      "starts_at","ends_at","now"
    ]);
    opaque(input.requester_ref);
    const request=opaque(input.request_ref);
    if(plan.kind==="external_player_account") {
      if(input.requester_ref!==plan.user_ref ||
         input.organization_ref!==undefined||input.club_ref!==undefined)
        throw Error("Scope mismatch: player identity.");
    } else if(plan.kind==="provider_supply_connection") {
      if(input.organization_ref!==plan.organization_ref ||
         input.club_ref!==plan.club_ref)
        throw Error("Scope mismatch: organization/club supply.");
    } else throw Error("Unknown connection kind.");
    const start=iso(input.starts_at),end=iso(input.ends_at),now=iso(input.now);
    const duration=Date.parse(end)-Date.parse(start);
    if(duration<=0||duration>MAX_WINDOW||Date.parse(now)>Date.parse(start))
      throw Error("Invalid absolute UTC search window.");
    const out=Object.freeze({
      mode:"synthetic_contract_only",status:"unknown",
      reason:"PROVIDER_AVAILABILITY_RIGHTS_UNVERIFIED",
      scope_type:plan.owner_type,provider:plan.provider,
      request_ref:request,
      requested_window:Object.freeze({starts_at:start,ends_at:end}),
      authoritative:false,provider_requests:0,
      can_display_available_slots:false,slots:Object.freeze([]),
      // Schema placeholders, not a quote, verified venue or booking path.
      slot_schema_fields:SLOT_SCHEMA,
      booking_mode:"none",deeplink:null,
      last_verified_at:null,data_freshness:"unverified",
      entitlement:"unverified",price:null,timezone:null
    });
    return out;
  }
  const api=Object.freeze({
    registry,slotFields,planExternalAccount,planProviderSupply,
    searchAvailableSlots
  });
  root.GACProviderSupplyContract=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
