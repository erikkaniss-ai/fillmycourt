// GAC P0 / Product Decision #104: FIRST-PARTY EPHEMERAL FUNNEL SHADOW.
// No fetch, beacon, persistent storage, user identity, GPS coordinates, or booking rights.
// NOT a production analytics pipeline; future transmission requires separate authorization.
(function(root){
  "use strict";
  const LIMIT=64;
  const STAGES=new Set(["search_requested","availability_result","slot_selected","booking_preview"]);
  const SPORTS=new Set(["padel","tennis","squash","badminton","pickleball"]);
  const PROVIDERS=new Set(["fillmycourt","native","playtomic","tiesports","racket_id","smashpro"]);
  const SOURCES=new Set(["hotel","tourism","municipality","federation","club","social","partner"]);
  const goodId=value=>typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)?value:null;
  const finiteCount=value=>Number.isSafeInteger(value)&&value>=0?Math.min(value,100000):0;

  function sourceFromSearch(search){
    try{
      const raw=new URLSearchParams(String(search||"")).get("utm_source");
      if(!raw)return "direct";
      const value=raw.trim().toLowerCase();
      return SOURCES.has(value)?value:"other";
    }catch{return "direct";}
  }
  function create({search=""}={}){
    const acquisitionSource=sourceFromSearch(search);
    let events=[],sequence=0;
    function record(stage,details={}){
      // Booking started, handoff, confirmation MUST NOT be inferred from UI clicks.
      // These require source-authoritative integration and a separately approved sink.
      if(!STAGES.has(stage))return null;
      const d=details&&typeof details==="object"?details:{};
      const event={
        schema_version:1,stage,sequence:++sequence,occurred_at:new Date().toISOString(),
        acquisition_source:acquisitionSource,
        sport:SPORTS.has(d.sport)?d.sport:"other",
        location_mode:d.locationMode==="near_me"?"near_me":"typed_area"
      };
      if(stage==="availability_result"){
        event.venues=finiteCount(d.venueCount);
        event.available_slots=finiteCount(d.slotCount);
        event.source_class=d.sourceClass==="core_reported"?"core_reported":"fixture_or_unknown";
        // Core-reported is an observation, NOT proof of real provider authority.
      }
      if(stage==="slot_selected"||stage==="booking_preview"){
        const venue=goodId(d.venueId),slot=goodId(d.slotId);
        if(!venue||!slot){sequence--;return null;}
        event.venue_id=venue;
        event.slot_id=slot;
        event.provider=PROVIDERS.has(d.provider)?d.provider:"unknown";
      }
      if(stage==="booking_preview")event.transaction_state="preview_only";
      const saved=Object.freeze(event);
      events.push(saved);
      if(events.length>LIMIT)events.shift();
      return {...saved};
    }
    return Object.freeze({
      record,
      snapshot:()=>events.map(e=>({...e})),
      clear:()=>{events=[];sequence=0;}
    });
  }
  const factory=Object.freeze({create,sourceFromSearch});
  root.GACSignals=create({search:root.location?.search||""});
  if(typeof module!=="undefined"&&module.exports)module.exports=factory;
})(globalThis);
