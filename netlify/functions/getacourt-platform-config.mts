import { coreJson, errorResponse, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  try {
    const platform = await coreJson("/api/config");
    const env=globalThis.Netlify?.env;
    const supabaseUrl=String(env?.get("GETACOURT_SUPABASE_URL")||"");
    const publishableKey=String(env?.get("GETACOURT_SUPABASE_PUBLISHABLE_KEY")||"");
    const authConfigured=Boolean(supabaseUrl && publishableKey);
    const googleEnabled=authConfigured &&
      String(env?.get("GETACOURT_GOOGLE_SIGNIN_ENABLED")||"").toLowerCase()==="true";
    return response({
      environment:"staging",
      bookingEnabled:Boolean(platform.booking_enabled),
      onlinePayments:Boolean(platform.online_payments),
      auth:platform.auth,
      authConfigured,
      googleSignInEnabled:googleEnabled,
      supabaseAuthUrl:googleEnabled?supabaseUrl:null,
      emailSignInEnabled:String(globalThis.Netlify?.env?.get("GETACOURT_EMAIL_SIGNIN_ENABLED") || "").toLowerCase() === "true",
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/platform-config" };
