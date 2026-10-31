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
  // Normalize key spelling so snake_case and HTTP headers are rejected too.
  const SENSITIVE_FIELDS=new Set([
    "accesstoken","refreshtoken","authorizationcode","clientsecret",
    "password","cookie","setcookie","credentials","apikey","xapikey",
    "authorization","privatekey","bearertoken"
  ]);
  const ISSUED_SYNTHETIC=new WeakSet();
  function credentialField(key){
    return SENSITIVE_FIELDS.has(key.replace(/[^a-z0-9]/gi,"").toLowerCase());
  }
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
      if(credentialField(key))throw Error("Provider credentials are not accepted by the synthetic foundation.");
      assertNoCredential(value,seen);
    }
  }
  function consent(input){
    assertNoCredential(input);
    const value=input&&typeof input==="object"?input:{};
    if(!isOpaqueRef(value.subject_ref)||!isOpaqueRef(value.proof_ref))
      throw Error("Use internal opaque subject_ref and proof_ref values.");
    if(value.scope!=="availability.read")throw Error("Only availability.read may be modeled.");
    return Object.freeze({
      subject_ref:value.subject_ref,proof_ref:value.proof_ref,scope:"availability.read",
      granted_at:asIso(value.granted_at),jurisdiction:typeof value.jurisdiction==="string"?value.jurisdiction:"unknown"
    });
  }
  function requireIssuedConnection(connection){
    if(!connection||typeof connection!=="object"||!ISSUED_SYNTHETIC.has(connection))
      throw Error("Issued synthetic connection required.");
  }
  function createSyntheticConnection(input={}){
    assertNoCredential(input);
    const definition=copyProvider(input.provider);
    const provider=Object.freeze({...definition,capabilities:Object.freeze({...definition.capabilities})});
    const evidence=consent(input.consent);
    if(!isOpaqueRef(input.connection_ref))throw Error("Use an opaque connection_ref.");
    const createdAt=asIso(input.created_at);
    if(Date.parse(evidence.granted_at)>Date.parse(createdAt))
      throw Error("Consent must not postdate synthetic connection creation.");
    // No provider state is claimed: no redirect, token, account identifier,
    // external request, scheduled sync, availability result, or write path.
    const connection=Object.freeze({
      connection_ref:input.connection_ref,provider,consent:evidence,
      mode:"synthetic_read_only",status:"not_authorized",
      token_state:"not_collected",freshness:"not_observed",
      created_at:createdAt,audit:Object.freeze([Object.freeze({
        event:"provider_connection.synthetic_created",at:createdAt,
        provider:provider.id,scope:evidence.scope
      })])
    });
    ISSUED_SYNTHETIC.add(connection);
    return connection;
  }
  function authorizationPlan(connection){
    requireIssuedConnection(connection);
    return Object.freeze({
      status:"blocked",reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED",
      provider:connection.provider.id,required_capability:"availability.read",
      account_link_supported:connection.provider.capabilities.account_link_supported,
      external_request:false,token_collection:false,scheduled_sync:false,provider_write:false
    });
  }
  function availabilityStatus(connection){
    requireIssuedConnection(connection);
    return Object.freeze({
      status:"unknown",freshness:"not_observed",provider_authorized:false,
      can_display_slots:false,slots:Object.freeze([]),
      reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED"
    });
  }

  // Dry-run contract for future *authorized* provider readers.
  // Never returns available slots or permits a provider request.
  function syntheticReadPreflight(connection,input={}){
    requireIssuedConnection(connection);
    assertNoCredential(input);
    const now=asIso(input.now);
    const current=Date.parse(now);
    const min=input.min_interval_ms===undefined?60000:input.min_interval_ms;
    if(!Number.isSafeInteger(min)||min<60000||min>86400000)
      throw Error("A conservative minimum interval of 60000..86400000ms is required.");
    let rateState="no_prior_attempt";
    let nextEligible=null;
    if(input.last_attempt_at!==undefined){
      const previous=Date.parse(asIso(input.last_attempt_at));
      if(previous>current)throw Error("Last attempt must not be in the future.");
      nextEligible=new Date(previous+min).toISOString();
      rateState=current<previous+min?"cooldown":"eligible_in_simulation";
    }
    let freshness="not_observed";
    if(input.last_fixture_observed_at!==undefined){
      const last=Date.parse(asIso(input.last_fixture_observed_at));
      if(last>current)throw Error("Fixture observation must not be in the future.");
      const ttl=input.fixture_ttl_ms===undefined?60000:input.fixture_ttl_ms;
      if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>86400000)
        throw Error("Fixture TTL must be 1000..86400000ms.");
      freshness=current-last<=ttl?"fresh_fixture_only":"stale";
    }
    return Object.freeze({
      mode:"simulation_only",status:"blocked",reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED",
      authorized:false,request_allowed:false,can_display_slots:false,
      slots:Object.freeze([]),rate_state:rateState,
      next_eligible_simulation_at:nextEligible,fixture_freshness:freshness,
      live_provider_observation:false,provider_write:false
    });
  }


  // Classification-only gate: a provider's booking event feed cannot prove
  // court availability or account-link rights, even when fixture data is fresh.
  // No HTTP, provider read, account ID or real venue data enters this contract.
  function inspectSyntheticObservation(connection,input={}){
    requireIssuedConnection(connection);
    assertNoCredential(input);
    if(input.kind!=="booking_events" && input.kind!=="availability_snapshot")
      throw Error("Unknown synthetic observation kind.");
    if(!isOpaqueRef(input.source_ref))
      throw Error("Use an opaque fixture source_ref.");
    const when=asIso(input.observed_at);
    const count=input.fixture_records_count===undefined?0:input.fixture_records_count;
    if(!Number.isSafeInteger(count)||count<0||count>100000)
      throw Error("Invalid fixture count.");
    return Object.freeze({
      mode:"simulation_only",kind:input.kind,
      source_ref:input.source_ref,fixture_observed_at:when,
      fixture_records_count:count,
      status:"not_authorized",provider_authorized:false,
      provider_read_occurred:false,can_link_player_account:false,
      booking_events_are_availability:false,can_display_availability:false,
      slots:Object.freeze([]),reason:"OFFICIAL_PROVIDER_AUTHORIZATION_REQUIRED"
    });
  }

  function disconnect(connection,at){
    requireIssuedConnection(connection);
    const timestamp=asIso(at);
    if(Date.parse(timestamp)<Date.parse(connection.created_at))
      throw Error("Disconnect must not predate synthetic connection creation.");
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
    authorizationPlan,availabilityStatus,syntheticReadPreflight,inspectSyntheticObservation,disconnect,canBeginDelegatedAuthorization,validateRegistry
  });
  root.GACProviderConnectionFoundation=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);
