// GetACourt Provider Connection Foundation — synthetic/read-only only.
//
// This is deliberately NOT an OAuth client, provider API client, token store,
// scheduler, or booking adapter. It models the capability and consent gates
// that a future *officially authorised* connector must satisfy. A player
// agreeing in GetACourt never upgrades an unverified provider capability.
(function(root){
  "use strict";

  const STATES=new Set(["unverified","verified","not_applicable"]);
  const CAPABILITIES=Object.freeze([
    "account_link_supported","discovery.read","availability.read",
    "provider_handoff","native_booking_authorized"
  ]);
  const SENSITIVE_FIELDS=new Set([
    "accessToken","refreshToken","authorizationCode","clientSecret",
    "password","cookie","credentials"
  ]);
  const PROVIDERS=Object.freeze({
    // The public Playtomic material currently documents a club/chain,
    // read-only API and Connect partner programme. It does not establish a
    // player-delegated OAuth flow or availability endpoint for GetACourt.
    playtomic:Object.freeze({
      id:"playtomic",display_name:"Playtomic",market:"Portugal P0",
      official_route:"club_or_certified_partner",capabilities:Object.freeze({
        account_link_supported:"unverified","discovery.read":"unverified",
        "availability.read":"unverified",provider_handoff:"unverified",
        native_booking_authorized:"not_applicable"
      })
    }),
    tiesports:Object.freeze({
      id:"tiesports",display_name:"TieSports / TiePlayer",market:"Portugal P0",
      official_route:"club_api_contract_required",capabilities:Object.freeze({
        account_link_supported:"unverified","discovery.read":"unverified",
        "availability.read":"unverified",provider_handoff:"unverified",
        native_booking_authorized:"not_applicable"
      })
    }),
    racket_id:Object.freeze({
      id:"racket_id",display_name:"Racket ID",market:"Portugal P0",
      official_route:"provider_contract_required",capabilities:Object.freeze({
        account_link_supported:"unverified","discovery.read":"unverified",
        "availability.read":"unverified",provider_handoff:"unverified",
        native_booking_authorized:"not_applicable"
      })
    }),
    smashpro:Object.freeze({
      id:"smashpro",display_name:"Smashpro",market:"Portugal P0",
      official_route:"provider_contract_required",capabilities:Object.freeze({
        account_link_supported:"unverified","discovery.read":"unverified",
        "availability.read":"unverified",provider_handoff:"unverified",
        native_booking_authorized:"not_applicable"
      })
    }),
    native_manual:Object.freeze({
      id:"native_manual",display_name:"Native / manual club path",market:"Portugal P0",
      official_route:"club_authorised_manual_handoff",capabilities:Object.freeze({
        account_link_supported:"not_applicable","discovery.read":"unverified",
        "availability.read":"unverified",provider_handoff:"unverified",
        native_booking_authorized:"not_applicable"
      })
    })
  });

  function copyProvider(provider){
    const source=PROVIDERS[provider];
    if(!source)throw Error("Unknown provider.");
    return {
      id:source.id,display_name:source.display_name,market:source.market,
      official_route:source.official_route,capabilities:{...source.capabilities}
    };
  }
  function registry(){return Object.keys(PROVIDERS).map(copyProvider);}
  function isOpaqueRef(value){return typeof value==="string"&&/^[a-z][a-z0-9_-]{2,79}$/i.test(value);}
  function asIso(value){
    if(typeof value!=="string"||Number.isNaN(Date.parse(value)))throw Error("Consent timestamp is required.");
    return new Date(value).toISOString();
  }
  function assertNoCredential(input,seen=new WeakSet()){
    if(!input||typeof input!=="object")return;
    if(seen.has(input))return;
    seen.add(input);
    for(const [key,value] of Object.entries(input)){
      if(SENSITIVE_FIELDS.has(key))throw Error("Provider credentials are not accepted by the synthetic foundation.");
      assertNoCredential(value,seen);
    }
  }
  function consent(input){
    const value=input&&typeof input==="object"?input:{};
    if(!isOpaqueRef(value.subject_ref)||!isOpaqueRef(value.proof_ref))
      throw Error("Use internal opaque subject_ref and proof_ref values.");
    if(value.scope!=="availability.read")throw Error("Only availability.read may be modeled.");
    return Object.freeze({
      subject_ref:value.subject_ref,proof_ref:value.proof_ref,scope:"availability.read",
      granted_at:asIso(value.granted_at),jurisdiction:typeof value.jurisdiction==="string"?value.jurisdiction:"unknown"
    });
  }
  function createSyntheticConnection(input={}){
    assertNoCredential(input);
    const provider=copyProvider(input.provider);
    const evidence=consent(input.consent);
    if(!isOpaqueRef(input.connection_ref))throw Error("Use an opaque connection_ref.");
    // No provider state is claimed: no redirect, token, account identifier,
    // external request, scheduled sync, availability result, or write path.
    return Object.freeze({
      connection_ref:input.connection_ref,provider,consent:evidence,
      mode:"synthetic_read_only",status:"not_authorized",
      token_state:"not_collected",freshness:"not_observed",
      created_at:asIso(input.created_at),audit:Object.freeze([Object.freeze({
        event:"provider_connection.synthetic_created",at:asIso(input.created_at),
        provider:provider.id,scope:evidence.scope
      })])
    });
  }
  function authorizationPlan(connection){
    if(!connection||connection.mode!=="synthetic_read_only")throw Error("Synthetic connection required.");
    return Object.freeze({
      status:"blocked",reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED",
      provider:connection.provider.id,required_capability:"availability.read",
      account_link_supported:connection.provider.capabilities.account_link_supported,
      external_request:false,token_collection:false,scheduled_sync:false,provider_write:false
    });
  }
  function disconnect(connection,at){
    if(!connection||connection.mode!=="synthetic_read_only")throw Error("Synthetic connection required.");
    const timestamp=asIso(at);
    return Object.freeze({
      connection_ref:connection.connection_ref,provider:connection.provider.id,
      status:"disconnected",token_state:"not_collected",external_revoke:false,
      audit:Object.freeze([...connection.audit,Object.freeze({
        event:"provider_connection.synthetic_disconnected",at:timestamp,provider:connection.provider.id
      })])
    });
  }
  function canBeginDelegatedAuthorization(provider){
    const definition=copyProvider(provider);
    return definition.capabilities.account_link_supported==="verified";
  }
  function validateRegistry(){
    for(const provider of Object.values(PROVIDERS)){
      for(const capability of CAPABILITIES){
        if(!STATES.has(provider.capabilities[capability]))throw Error("Invalid provider capability registry.");
      }
      if(provider.capabilities.native_booking_authorized!=="not_applicable")
        throw Error("No native provider booking is authorised in this foundation.");
    }
    return true;
  }

  const api=Object.freeze({
    capability_names:CAPABILITIES,registry,consent,createSyntheticConnection,
    authorizationPlan,disconnect,canBeginDelegatedAuthorization,validateRegistry
  });
  root.GACProviderConnectionFoundation=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
