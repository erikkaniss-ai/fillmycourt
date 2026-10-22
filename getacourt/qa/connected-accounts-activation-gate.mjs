// Issue #11: offline proof-inventory gate for prospective provider integrations.
// Untrusted declarations can NEVER authorize network traffic, token access,
// availability, client OAuth, booking or release. No connected app imports this.
const PROVIDERS=Object.freeze(new Set([
  "playtomic","tiesports","matchi","racket_id","smashpro"
]));
const REF=/^[a-z][a-z0-9_-]{2,79}$/i;
const SHA=/^[0-9a-f]{40}$/;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const DAY=86400000;
export const GATES=Object.freeze({
  club_native:Object.freeze([
    "signed_club_distribution_right",
    "core_single_writer_attestation","named_court_coverage",
    "club_pricing_permission","club_freshness_policy",
    "data_minimization_review","operator_authority_review"
  ]),
  external_club_supply:Object.freeze([
    "signed_club_distribution_right","provider_contract",
    "provider_availability_scope","provider_price_scope",
    "provider_redistribution_license","named_court_coverage",
    "provider_rate_and_freshness","provider_dpa",
    "server_vault_design","provider_revocation_procedure",
    "operator_authority_review"
  ]),
  external_player_account:Object.freeze([
    "documented_player_delegation","exact_user_consent",
    "delegation_read_scope","provider_redistribution_license",
    "provider_dpa","server_vault_design",
    "provider_revocation_procedure","token_expiry_rotation_plan",
    "independent_provider_authority_review"
  ])
});
export const MODES=Object.freeze({
  club_native:"Core native inventory; club-owned/authorised and Core sole writer",
  external_club_supply:"Club-sponsored licensed external supply; NOT booking authority",
  external_player_account:"Player-delegated access; NOT club-wide supply authority"
});
const RESULT_CODE="DECLARATIONS_ARE_NOT_VERIFIED_PROVIDER_RIGHTS";
function strict(value,keys) {
  if(!value||typeof value!=="object"||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw Error("INVALID_MANIFEST");
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors))
    if(typeof key!=="string"||!keys.includes(key)||!("value" in descriptors[key]))
      throw Error("INVALID_MANIFEST");
  return value;
}
function opaque(value) {
  if(typeof value!=="string"||!REF.test(value))throw Error("INVALID_REFERENCE");
  return value;
}
function instant(value) {
  if(typeof value!=="string"||!UTC.test(value)||!Number.isFinite(Date.parse(value)))
    throw Error("INVALID_UTC_INSTANT");
  const d=new Date(value).toISOString();
  if(value!==d&&value!==d.replace(".000Z","Z"))throw Error("INVALID_UTC_INSTANT");
  return Date.parse(d);
}
function fixedOutput(provider,lane,needed,listed,review){
  return Object.freeze({
    schema_version:1,lane,provider,
    status:review?"DECLARED_READY_FOR_ORIGINAL_EVIDENCE_REVIEW":"BLOCKED",
    reason:RESULT_CODE,
    required_items:needed.length,
    declared_items:listed.length,
    missing_evidence:Object.freeze(needed.filter(x=>!listed.includes(x))),
    evidence_reviewed:false,authority_verified:false,licensed_inventory_verified:false,
    consent_verified:false,
    // Hard disable of every effect; no evidence manifest may unlock execution.
    may_create_account:false,may_authenticate_provider:false,
    may_access_token_vault:false,may_fetch_provider:false,
    may_publish_slots:false,may_redistribute_price:false,
    may_confirm_booking:false,execution_enabled:false,
    next_stage:review?"INDEPENDENT_ORIGINAL_EVIDENCE_AND_LEGAL_REVIEW":
                      "COLLECT_MISSING_EVIDENCE_OFFLINE"
  });
}
/**
 * Report declared evidence completeness only. All input is untrusted and
 * evaluated locally; a malicious client can forge any "document" reference.
 * A separate authenticated server-side original-evidence attestation and
 * scoped owner GO are non-negotiable for a future enabled adapter.
 */
export function inspectReadiness(raw,{now}={}) {
  const input=strict(raw,[
    "schema_version","lane","provider","owner_ref","organization_ref",
    "club_ref","candidate_sha","observed_at","expires_at","evidence"
  ]);
  if(input.schema_version!==1||!Object.hasOwn(GATES,input.lane)||
     typeof input.provider!=="string")
    throw Error("INVALID_MANIFEST");
  const lane=input.lane,provider=input.provider;
  if(lane==="club_native"?provider!=="native":!PROVIDERS.has(provider))
    throw Error("INVALID_PROVIDER_LANE");
  opaque(input.owner_ref);
  if(lane==="external_player_account"){
    if(input.organization_ref!==undefined||input.club_ref!==undefined)
      throw Error("CROSS_OWNER_SCOPE");
  }else{
    opaque(input.organization_ref);opaque(input.club_ref);
    if(input.owner_ref!==input.organization_ref)
      throw Error("CROSS_OWNER_SCOPE");
  }
  if(typeof input.candidate_sha!=="string"||!SHA.test(input.candidate_sha))
    throw Error("INVALID_SOURCE_SHA");
  const seen=instant(input.observed_at),expiry=instant(input.expires_at),
        clock=instant(now);
  if(seen>clock||expiry<=clock||expiry<=seen||expiry-seen>30*DAY)
    throw Error("EXPIRED_OR_INVALID_REVIEW_WINDOW");
  const required=GATES[lane];
  const evidence=strict(input.evidence,required);
  const listed=[];
  for(const [key,ref] of Object.entries(evidence)) {
    if(ref===undefined||ref===null||ref==="")continue;
    opaque(ref);
    listed.push(key);
  }
  return fixedOutput(provider,lane,required,listed,listed.length===required.length);
}
export function listRequiredEvidence(lane){
  if(!Object.hasOwn(GATES,lane))throw Error("INVALID_LANE");
  return Object.freeze([...GATES[lane]]);
}
// This makes the execution interface explicit without implementing one.
export function planVaultAdapter(raw) {
  const input=strict(raw,["mode"]);
  const mode=input.mode;
  if(!["club_credentials","delegated_refresh_token"].includes(mode))
    throw Error("INVALID_SECRET_CLASS");
  return Object.freeze({
    mode,storage:"UNCONFIGURED",key_management:"UNCONFIGURED",
    service_role_exposure:false,client_side_access:false,
    encrypted_material_present:false,vault_handle:null,
    transport_enabled:false,rotation_enabled:false,
    require_independent_admin_review:true,
    candidate_backends:Object.freeze(["managed_kms_envelope","supabase_vault_restricted"]),
    note:"Architecture options only; no token storage, encryption key or decrypt path."
  });
}
