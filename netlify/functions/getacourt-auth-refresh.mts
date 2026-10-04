import { body, env, errorResponse, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    const input = await body(req);
    if (!input.refreshToken) return response({ error:"REFRESH_REQUIRED", message:"refreshToken is required" }, 400);
    const base = env("GETACOURT_SUPABASE_URL").replace(/\/$/, "");
    const key = env("GETACOURT_SUPABASE_PUBLISHABLE_KEY");
    const upstream = await fetch(base + "/auth/v1/token?grant_type=refresh_token", {
      method:"POST",
      headers:{ "apikey":key, "content-type":"application/json" },
      body:JSON.stringify({ refresh_token:input.refreshToken }),
    });
    let data = {};
    try { data = await upstream.json(); } catch {}
    if (!upstream.ok) {
      const error = new Error(data.msg || data.message || data.error_description || "Session refresh failed.");
      error.status = upstream.status;
      error.code = data.error_code || "AUTH_REFRESH_FAILED";
      throw error;
    }
    return response(data);
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/auth/refresh" };
