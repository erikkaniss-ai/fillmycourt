// FillMyCourt private-preview only: strictly GET-only gateway to Railway Operations.
// Never route to transactional Core or a provider; no server-side privileged token.
// The deployed staging Operations API verifies the forwarded player's Supabase JWT.
// Fixed, independent staging site: no public Fill/MyCourt project is permitted.
const FILL_PREVIEW_SITE_ID = "d763b7a1-dccd-4638-8876-ac1670171698";
const OPERATIONS_HOST = "fmc-operations-api-staging.up.railway.app";
const OPERATIONS_BASE = "https://" + OPERATIONS_HOST;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "pragma": "no-cache",
  "vary": "Authorization",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive"
};
const reply = (status, error) => new Response(JSON.stringify({error}), {
  status, headers: JSON_HEADERS
});
function onlyOneQuery(url, allowed) {
  const names = [...url.searchParams.keys()];
  return names.length === allowed.length &&
    names.every((k, i) => allowed.includes(k) && names.indexOf(k) === i);
}
function exactDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function route(url) {
  const path = url.pathname;
  if (path === "/api/me" || path === "/api/fmc/organizations") {
    return url.search === "" ? {path} : {error: "INVALID_QUERY"};
  }
  const match = /^\/api\/fmc\/([^/]+)\/(today|calendar)$/.exec(path);
  if (!match) return null;
  const org = match[1], operation = match[2];
  if (!UUID.test(org)) return {error: "INVALID_ORGANIZATION"};
  if (operation === "today") {
    if (!onlyOneQuery(url, ["date"]) || !exactDate(url.searchParams.get("date")))
      return {error: "INVALID_DATE"};
    return {path: "/api/fmc/" + org + "/today?date=" +
      encodeURIComponent(url.searchParams.get("date"))};
  }
  if (!onlyOneQuery(url, ["start", "end"])) return {error: "INVALID_RANGE"};
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const beginMs = Date.parse(start || "");
  const endMs = Date.parse(end || "");
  if (!Number.isFinite(beginMs) || !Number.isFinite(endMs) ||
      !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(start || "") ||
      !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(end || "") ||
      endMs <= beginMs || endMs - beginMs > 31 * 86400000)
    return {error: "INVALID_RANGE"};
  return {path: "/api/fmc/" + org + "/calendar?start=" +
    encodeURIComponent(start) + "&end=" + encodeURIComponent(end)};
}
function configuredBase(context) {
  // Netlify's trusted runtime context binds the request to one staging-only
  // project. A mistaken deployment on the public FillMyCourt site fails shut.
  if (context?.site?.id !== FILL_PREVIEW_SITE_ID) return null;
  // This is a PUBLIC address, not a secret. The optional site environment
  // variable is backwards-compatible but no longer a deployment prerequisite.
  // It may only point to the exact verified Railway Operations host.
  const value = globalThis.Netlify?.env?.get("FILL_OPERATIONS_API_BASE") || OPERATIONS_BASE;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== OPERATIONS_HOST ||
      parsed.username || parsed.password || parsed.port ||
      (parsed.pathname !== "/" && parsed.pathname !== "") ||
      parsed.search || parsed.hash) return null;
  return parsed.origin;
}
export default async function fillOperatorReadonly(request, context) {
  if (request.method !== "GET") return reply(405, "READ_ONLY");
  const url = new URL(request.url);
  const destination = route(url);
  if (!destination) return reply(404, "NOT_FOUND");
  if (destination.error) return reply(422, destination.error);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return reply(403, "INVALID_ORIGIN");
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer [^\s]{10,4096}$/.test(authorization))
    return reply(401, "AUTH_REQUIRED");
  const base = configuredBase(context);
  if (!base) return reply(503, "UNAPPROVED_PREVIEW_SITE_OR_OPERATIONS");
  try {
    const upstream = await fetch(base + destination.path, {
      method: "GET", redirect: "manual", cache: "no-store",
      headers: {authorization, accept: "application/json"},
      signal: AbortSignal.timeout(9000)
    });
    if (upstream.status >= 300 && upstream.status < 400)
      return reply(502, "OPERATIONS_REDIRECT_REJECTED");
    if (!upstream.headers.get("content-type")?.toLowerCase().includes("application/json"))
      return reply(502, "OPERATIONS_INVALID_RESPONSE");
    if (Number(upstream.headers.get("content-length") || 0) > 1024 * 1024)
      return reply(502, "OPERATIONS_RESPONSE_LIMIT");
    const body = await upstream.text();
    if (body.length > 1024 * 1024) return reply(502, "OPERATIONS_RESPONSE_LIMIT");
    return new Response(body, {status: upstream.status, headers: JSON_HEADERS});
  } catch {
    return reply(502, "OPERATIONS_UNAVAILABLE");
  }
}
export const config = {
  path: ["/api/me", "/api/fmc/organizations",
    "/api/fmc/:org/today", "/api/fmc/:org/calendar"]
};
