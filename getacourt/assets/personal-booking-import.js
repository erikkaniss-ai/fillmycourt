// GetACourt personal booking import — user-supplied calendar events only.
// Not Playtomic/TieSports/MATCHi OAuth, not live inventory and not provider sync.
// No fetch, cookies, credentials, persistence, telemetry, or API writes.
(function(root){
  "use strict";
  const SUPPORTED=new Set(["playtomic","tiesports","matchi","other"]);
  const MAX_BYTES=131072,MAX_EVENTS=250,MAX_LINES=7000;
  const OWNER=/^[a-z0-9][a-z0-9_-]{2,127}$/i;
  const UTC=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;
  function utc(value) {
    const m=UTC.exec(value||"");
    if(!m)throw Error("Only unambiguous UTC calendar event times are supported.");
    const y=Number(m[1]),mo=Number(m[2]),day=Number(m[3]);
    const h=Number(m[4]),min=Number(m[5]),sec=Number(m[6]);
    if(y<2000||y>2100)throw Error("Calendar date outside supported range.");
    const d=new Date(Date.UTC(y,mo-1,day,h,min,sec));
    if(!Number.isFinite(d.getTime())||
       d.getUTCFullYear()!==y||d.getUTCMonth()!==mo-1||
       d.getUTCDate()!==day||d.getUTCHours()!==h||
       d.getUTCMinutes()!==min||d.getUTCSeconds()!==sec)
      throw Error("Invalid UTC calendar event time.");
    return d.toISOString();
  }
  function textField(value) {
    const raw=String(value||"").replace(/\\[nN]/g," ").replace(/\\([,;\\])/g,"$1");
    // Imported calendars may accidentally contain contact details.
    const noContacts=raw.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,"[redacted]")
      .replace(/\+?\d[\d \-()]{8,}\d/g,"[redacted]");
    return noContacts.replace(/[\u0000-\u001f\u007f<>]/g," ").trim().slice(0,120);
  }
  function parseIcs(raw,{provider}={}){
    if(!SUPPORTED.has(provider))throw Error("Choose the source of your own calendar file.");
    if(typeof raw!=="string"||new TextEncoder().encode(raw).length>MAX_BYTES||
      raw.includes("\u0000"))
      throw Error("Calendar file is too large or invalid (128 KiB limit).");
    const physical=raw.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");
    if(physical.length>MAX_LINES)throw Error("Calendar has too many lines.");
    const lines=[];
    for(const line of physical) {
      if(/^[ \t]/.test(line) && lines.length) lines[lines.length-1]+=line.slice(1);
      else lines.push(line);
    }
    if(!lines.some(s=>s.toUpperCase()==="BEGIN:VCALENDAR")||
       !lines.some(s=>s.toUpperCase()==="END:VCALENDAR"))
      throw Error("Select a calendar .ics file, not a password or account export.");
    const events=[];let current=null;
    for(const line of lines){
      const upper=line.toUpperCase();
      if(upper==="BEGIN:VEVENT"){
        if(current!==null)throw Error("Nested calendar event.");
        current={};
        continue;
      }
      if(upper==="END:VEVENT"){
        if(current===null)throw Error("Invalid calendar event boundary.");
        if(!current.start||!current.end)throw Error("Event has no UTC start/end time.");
        const start=utc(current.start),end=utc(current.end);
        const length=Date.parse(end)-Date.parse(start);
        if(length<=0||length>24*3600000)throw Error("Invalid event duration.");
        if(current.status!=="CANCELLED") {
          events.push(Object.freeze({
            provider,startsAt:start,endsAt:end,
            title:textField(current.summary)||"Court session",
            venue:textField(current.location)||"Venue not specified",
            origin:"user_imported_calendar",
            bookingAuthority:"unverified",
            providerAuthenticated:false,
            confirmsAvailableCourt:false
          }));
          if(events.length>MAX_EVENTS)throw Error("Calendar contains too many events.");
        }
        current=null;
        continue;
      }
      if(current===null)continue;
      const index=line.indexOf(":");
      if(index<0)continue;
      const rawKey=line.slice(0,index).toUpperCase();
      const key=rawKey.split(";")[0],v=line.slice(index+1);
      if(key==="DTSTART"||key==="DTEND"){
        if(rawKey!==key||current[key==="DTSTART"?"start":"end"]!==undefined)
          throw Error("Only unambiguous single UTC start/end values are supported.");
        current[key==="DTSTART"?"start":"end"]=v;
      }else if(key==="STATUS")current.status=v.toUpperCase();
      else if(key==="SUMMARY")current.summary=v;
      else if(key==="LOCATION")current.location=v;
      // Drop UID, attendee details, contact data, descriptions, hyperlinks,
      // GEO, organizer, attachment, alarm and all unrecognised fields.
    }
    if(current!==null)throw Error("Unclosed calendar event.");
    return Object.freeze(events.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)));
  }
  function createStore(){
    let owner=null,records=Object.freeze([]);
    function clear(){owner=null;records=Object.freeze([]);}
    function validOwner(value){
      if(typeof value!=="string"||!OWNER.test(value))throw Error("Valid signed-in account reference required.");
    }
    return Object.freeze({
      importIcs({ownerRef,provider,content}={}){
        validOwner(ownerRef);
        if(owner!==null && owner!==ownerRef)throw Error("Account scope mismatch; clear old data first.");
        // Parse fully before committing any memory changes.
        const parsed=parseIcs(content,{provider});
        owner=ownerRef;records=parsed;
        return records.length;
      },
      list(ownerRef){
        validOwner(ownerRef);
        if(owner!==ownerRef)return Object.freeze([]);
        return Object.freeze([...records]);
      },
      clear,
      get count(){return records.length;}
    });
  }
  const api=Object.freeze({parseIcs,createStore,MAX_BYTES});
  root.GACPersonalBookingImports=api;
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(globalThis);