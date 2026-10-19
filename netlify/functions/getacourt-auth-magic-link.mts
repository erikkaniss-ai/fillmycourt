import { body, env, errorResponse, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    // Explicitly disable email delivery at the server boundary, not only in UI.
    // Never invoke Supabase OTP or create users when the preview feature is OFF.
    const origin=req.headers.get("origin");
    if(origin && origin!==new URL(req.url).origin)
      return response({error:"INVALID_ORIGIN"},403);
    if(String(globalThis.Netlify?.env?.get("GETACOURT_EMAIL_SIGNIN_ENABLED")||"").toLowerCase()!=="true")
      return response({error:"EMAIL_SIGNIN_DISABLED"},503);
    const input = await body(req);
    const email = String(input.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return response({ error:"EMAIL_REQUIRED", message:"Valid email is required." }, 400);
    const base = env("GETACOURT_SUPABASE_URL").replace(/\/$/, "");
    const key = env("GETACOURT_SUPABASE_PUBLISHABLE_KEY");
    const redirect = env("GETACOURT_AUTH_REDIRECT_URL");
    const url = new URL(base + "/auth/v1/otp");
    url.searchParams.set("redirect_to", redirect);
    const upstream = await fetch(url, {
      method:"POST",
      headers:{ "apikey":key, "content-type":"application/json" },
      body:JSON.stringify({ email, create_user:true }),
    });
    let data = {};
    try { data = await upstream.json(); } catch {}
    if (!upstream.ok) {
      const error = new Error(data.msg || data.message || data.error_description || "Could not send sign-in link.");
      error.status = upstream.status;
      error.code = data.error_code || "AUTH_SEND_FAILED";
      throw error;
    }
    return response({ ok:true });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/auth/magic-link" };
