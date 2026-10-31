// ISOLATED SYNTHETIC DEMO. These records are not real club inventory.
(function(root) {
  "use strict";
  const ORG="11111111-1111-4111-8111-111111111111";
  const A="22222222-2222-4222-8222-222222222222";
  const B="33333333-3333-4333-8333-333333333333";
  const C="44444444-4444-4444-8444-444444444444";
  const next=day=>{const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
  function offset(day, time) {
    // Pick the correct offset for the LOCAL clock instant. At Portugal's DST
    // switch, midnight and midday use different offsets; selecting midday for
    // both made synthetic day bounds 24h instead of the actual 23h/25h.
    const utcWall = Date.parse(day + "T" + time + ":00Z");
    if (!Number.isFinite(utcWall)) throw Error("Invalid synthetic local date");
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23",
    });
    // UTC+1 first: repeated autumn hour deliberately resolves to the first
    // occurrence for a fixture, never used for authoritative booking writes.
    for (const offsetMinutes of [60, 0]) {
      const fields = format.formatToParts(new Date(utcWall - offsetMinutes * 60000));
      const part = (name) => fields.find((field) => field.type === name)?.value || "";
      const candidate = part("year") + "-" + part("month") + "-" + part("day");
      const clock = part("hour") + ":" + part("minute");
      if (candidate === day && clock === time)
        return offsetMinutes === 60 ? "+01:00" : "+00:00";
    }
    throw Error("Nonexistent synthetic local time");
  }
  const stamp = (day, time) => day + "T" + time + ":00" + offset(day, time);
  function today(day){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T12:00:00Z"))||new Date(day+"T12:00:00Z").toISOString().slice(0,10)!==day)throw Error("Invalid demo date");
    return {date:day,day_start:stamp(day,"00:00"),day_end:stamp(next(day),"00:00"),timezone:"Europe/Lisbon",currency:"EUR",
      summary:{capacity_minutes:1080,booked_minutes:300,held_minutes:60,blocked_minutes:60,
        empty_minutes:660,utilization_pct:27.8,bookings:3,cancellations:1,revenue_minor:9000,
        active_courts:3,courts_with_rate_coverage:2,courts_without_rate_coverage:1,
        bookable_60_starts:12,bookable_90_starts:8,highest_single_quote_minor:4800,
        highest_single_quote_duration_minutes:90},
      courts:[
        {court_id:A,court_name:"DEMO Indoor Court A",has_rate_coverage:true,
          open_start_minute:540,open_end_minute:1140,capacity_minutes:600,booked_minutes:180,
          held_minutes:60,blocked_minutes:0,empty_minutes:360,utilization_pct:30,
          bookings:1,cancellations:0,revenue_minor:5400,
          sellable_windows:[{start_minute:540,end_minute:1140}]},
        {court_id:B,court_name:"DEMO Outdoor Court B",has_rate_coverage:true,
          open_start_minute:600,open_end_minute:1080,capacity_minutes:480,booked_minutes:120,
          held_minutes:0,blocked_minutes:60,empty_minutes:300,utilization_pct:25,
          bookings:1,cancellations:1,revenue_minor:3600,
          sellable_windows:[{start_minute:600,end_minute:1080}]},
        {court_id:C,court_name:"DEMO Court C — needs price",has_rate_coverage:false,
          open_start_minute:0,open_end_minute:0,capacity_minutes:0,booked_minutes:0,
          held_minutes:0,blocked_minutes:0,empty_minutes:0,utilization_pct:0,bookings:0,cancellations:0,
          revenue_minor:0,sellable_windows:[]}
      ],
      empty_windows:[
        {court_id:A,court_name:"DEMO Indoor Court A",starts_at:stamp(day,"14:00"),ends_at:stamp(day,"18:00"),
          duration_minutes:240,bookable_60_count:7,bookable_90_count:5,best_amount_minor:4800,
          best_duration_minutes:90,best_starts_at:stamp(day,"14:00"),currency:"EUR"},
        {court_id:B,court_name:"DEMO Outdoor Court B",starts_at:stamp(day,"13:00"),ends_at:stamp(day,"16:00"),
          duration_minutes:180,bookable_60_count:5,bookable_90_count:3,best_amount_minor:4200,
          best_duration_minutes:90,best_starts_at:stamp(day,"13:00"),currency:"EUR"}
      ]
    };
  }
  function calendar(day){
    return {
      bookings:[
        {court_id:A,starts_at:stamp(day,"09:30"),ends_at:stamp(day,"12:30"),status:"confirmed",source:"SYNTHETIC DEMO"},
        {court_id:B,starts_at:stamp(day,"10:00"),ends_at:stamp(day,"12:00"),status:"confirmed",source:"SYNTHETIC DEMO"},
        // Occupied despite no rate: Core Calendar is not limited to sellable rates.
        {court_id:C,starts_at:stamp(day,"07:00"),ends_at:stamp(day,"08:30"),status:"confirmed",source:"SYNTHETIC DEMO"},
        // Historical cancellation: never occupy the current capacity grid.
        {court_id:A,starts_at:stamp(day,"14:00"),ends_at:stamp(day,"14:30"),status:"cancelled",source:"SYNTHETIC DEMO"}],
      holds:[{court_id:A,starts_at:stamp(day,"12:30"),ends_at:stamp(day,"13:30")}],
      blocks:[{court_id:B,starts_at:stamp(day,"16:00"),ends_at:stamp(day,"17:00"),reason:"SYNTHETIC DEMO block"}]
    };
  }
  function get(path){
    const url=new URL(path,"https://synthetic-fixture.invalid");
    if(url.pathname==="/api/me"&&!url.search)return {user:{email:"demo-operator@example.invalid"}};
    if(url.pathname==="/api/fmc/organizations"&&!url.search)
      return {items:[{id:ORG,name:"DEMO CLUB — SYNTHETIC ONLY",role:"fixture"}]};
    const m=/^\/api\/fmc\/([^/]+)\/(today|calendar)$/.exec(url.pathname);
    if(!m||m[1]!==ORG)throw Error("Synthetic fixture rejects this route");
    if(m[2]==="today"){
      if([...url.searchParams.keys()].join(",")!=="date")throw Error("Demo date required");
      return today(url.searchParams.get("date"));
    }
    if([...url.searchParams.keys()].sort().join(",")!=="end,start")throw Error("Demo range required");
    const start=url.searchParams.get("start");
    if(!start||!Number.isFinite(Date.parse(start)))throw Error("Invalid demo start");
    return calendar(start.slice(0,10));
  }
  root.FillDemo=Object.freeze({get});
})(globalThis);
