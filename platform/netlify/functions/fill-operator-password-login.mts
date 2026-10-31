// Private FillMyCourt staging email/password LOGIN only.
// Never creates users, memberships, booking records, messages or payments.
// Uses a PUBLIC staging Supabase publishable key (not service role).
const SITE = "d763b7a1-dccd-4638-8876-ac1670171698";
const SUPABASE = "https://yclqnbcrchwieyzkyumx.supabase.co";
const PUBLISHABLE = "sb_publishable_rBFZMzR0FQXL8Sl_8bZsLg_JvlJKviI";
const HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "pragma": "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive"
});
const answer = (status,error) => Response.json({error},{status,headers:HEADERS});

export default async function operatorPasswordLogin(request,context) {
  if (context?.site?.id !== SITE) return answer(403,"PREVIEW_ONLY");
  if (request.method !== "POST") return answer(405,"POST_REQUIRED");
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return answer(403,"ORIGIN");
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("application/json")) return answer(415,"JSON_REQUIRED");
  if (Number(request.headers.get("content-length") || 0) > 2048) return answer(413,"TOO_LARGE");
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return answer(413,"TOO_LARGE");
    body = JSON.parse(raw);
  } catch {
    return answer(400,"INVALID_REQUEST");
  }
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 1 || password.length > 1024) return answer(400,"INVALID_REQUEST");
  try {
    const upstream = await fetch(SUPABASE + "/auth/v1/token?grant_type=password", {
      method:"POST", redirect:"manual", cache:"no-store",
      headers: {apikey:PUBLISHABLE,"content-type":"application/json",accept:"application/json"},
      body:JSON.stringify({email,password}),
      signal: AbortSignal.timeout(9000)
    });
    // Never disclose whether an account exists, or proxy upstream diagnostics.
    if (!upstream.ok) return answer(401,"INVALID_CREDENTIALS");
    if (!upstream.headers.get("content-type")?.toLowerCase().includes("application/json"))
      return answer(502,"AUTH_INVALID_RESPONSE");
    if (Number(upstream.headers.get("content-length") || 0) > 8192)
      return answer(502,"AUTH_INVALID_RESPONSE");
    const raw = await upstream.text();
    if (raw.length > 8192) return answer(502,"AUTH_INVALID_RESPONSE");
    const data = JSON.parse(raw);
    if (typeof data.access_token !== "string" ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.access_token))
      return answer(502,"AUTH_INVALID_RESPONSE");
    const seconds = Number(data.expires_in);
    return new Response(JSON.stringify({
      access_token:data.access_token,
      expires_in:Number.isFinite(seconds)&&seconds>0?Math.min(seconds,86400):3600
    }),{status:200,headers:HEADERS});
  } catch {
    return answer(502,"AUTH_UNAVAILABLE");
  }
}
export const config = {path:"/api/fmc-auth/login"};
