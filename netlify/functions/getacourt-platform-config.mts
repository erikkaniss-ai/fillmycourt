import { coreJson, env, errorResponse, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  try {
    const platform = await coreJson("/api/config");
    return response({
      environment:"staging",
      bookingEnabled:Boolean(platform.booking_enabled),
      onlinePayments:Boolean(platform.online_payments),
      auth:platform.auth,
      authConfigured:Boolean(globalThis.Netlify?.env?.get("GETACOURT_SUPABASE_URL") && globalThis.Netlify?.env?.get("GETACOURT_SUPABASE_PUBLISHABLE_KEY")),
      emailSignInEnabled:String(globalThis.Netlify?.env?.get("GETACOURT_EMAIL_SIGNIN_ENABLED") || "").toLowerCase() === "true",
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/platform-config" };
