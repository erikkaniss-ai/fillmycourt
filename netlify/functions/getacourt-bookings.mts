import { coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

function localParts(value, venueTimezone) {
  const d = new Date(value);
  // Club-owned venue timezone is authoritative; NEVER use the browser's zone.
  // Core may be on an older pin during controlled rollout, so UTC is an
  // explicit fallback instead of an assumed local timezone.
  const timeZone = venueTimezone || "UTC";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false, hourCycle:"h23",
  });
  const fields = Object.fromEntries(formatter.formatToParts(d)
    .filter(p => p.type !== "literal").map(p => [p.type,p.value]));
  const time = fields.hour + ":" + fields.minute;
  // A fall-back 01:30 exists twice. Detect ambiguity from the venue's own
  // IANA timezone even when only one booking was returned by Core.
  const wall = formatter.format(d);
  const repeated = [-3600000,3600000].some(ms =>
    formatter.format(new Date(d.getTime()+ms)) === wall);
  let displayTime = time;
  if (repeated) {
    const shortOffset = new Intl.DateTimeFormat("en-GB", {
      timeZone, timeZoneName:"shortOffset"
    }).formatToParts(d).find(p=>p.type==="timeZoneName")?.value || "GMT";
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(shortOffset);
    const offset = !match ? shortOffset.replace(/^GMT/,"UTC") :
      !match[1] ? "UTC+0" :
      "UTC"+match[1]+Number(match[2])+(match[3] ? ":"+match[3] : "");
    displayTime = time + " " + offset;
  }
  return {
    date: fields.year + "-" + fields.month + "-" + fields.day,
    time, displayTime,
  };
}

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const data = await coreJson("/api/bookings", { method:"GET" }, req);
    const bookings = (data.items || []).map(item => {
      const p = localParts(item.starts_at, item.venue_timezone);
      const duration = Math.max(0, Math.round((new Date(item.ends_at) - new Date(item.starts_at)) / 60000));
      return {
        bookingId:item.id,
        reference:String(item.id || "").slice(0,8).toUpperCase(),
        status:item.status,
        venue:{ name:item.venue_name || "Court booking", timezone:item.venue_timezone || "UTC" },
        slot:{ date:p.date, time:p.time, displayTime:p.displayTime, duration },
        currency:item.currency,
        grossAmountMinor:item.gross_amount_minor,
        source:item.source,
      };
    });
    return response({ bookings });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/bookings" };
