import { body, coreJson, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async (req) => {
  if (req.method !== "POST") return response({ error:"Method not allowed" }, 405);
  try {
    requireAuth(req);
    const input = await body(req);
    const routineId = String(input.routineId || "").trim();
    if (!routineId) return response({ error:"ROUTINE_REQUIRED", message:"routineId is required." }, 400);
    return response(await coreJson(
      "/api/play-routines/" + encodeURIComponent(routineId) + "/evaluate",
      { method:"POST" },
      req
    ));
  } catch (error) {
    return errorResponse(error);
  }
};

export const config = { path:"/api/gac/play-routine-evaluate" };
