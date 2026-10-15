import { body, coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (!["GET","PUT"].includes(req.method)) return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    if (req.method === "GET") {
      return response(await coreJson("/api/player-profile", { method:"GET" }, req));
    }
    const input = await body(req);
    return response(await coreJson("/api/player-profile", {
      method:"PUT",
      body:JSON.stringify({
        full_name:input.fullName,
        home_area:input.homeArea || null,
        preferred_sports:Array.isArray(input.preferredSports) ? input.preferredSports : [],
        locale:input.locale || "en",
        marketing_consent:input.marketingConsent == null ? null : Boolean(input.marketingConsent),
      }),
    }, req));
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/player-profile" };
