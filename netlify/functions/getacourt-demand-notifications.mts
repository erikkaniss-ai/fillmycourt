import { coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "GET") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));
    return response(await coreJson("/api/demand-notifications?limit=" + limit, { method:"GET" }, req));
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/demand-notifications" };
