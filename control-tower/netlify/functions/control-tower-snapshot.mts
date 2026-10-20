import projects from "../../config/projects.json" with { type: "json" };
import { buildSnapshot } from "../../server.mjs";

const SITE_ID = "d763b7a1-dccd-4638-8876-ac1670171698";
let cached: unknown = null;
let expires = 0;
let pending: Promise<unknown> | null = null;

export default async (request: Request, context: { site: { id: string }; deploy: { context: string } }) => {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow"
  };
  if (context.site.id !== SITE_ID || context.deploy.context === "production") {
    return Response.json({ error: "PRIVATE_NONPRODUCTION_SITE_REQUIRED" }, { status: 503, headers });
  }
  if (request.method !== "GET") return Response.json({ error: "READ_ONLY" }, { status: 405, headers });
  if (!cached || Date.now() >= expires) {
    // Dedicated two-repository read-only credential: Functions scope only, never client-side.
    // Never use the deployment token or a personal CLI credential for GitHub reads.
    const privateToken = process.env.CONTROL_TOWER_GITHUB_READ_TOKEN || "";
    pending ||= buildSnapshot(projects, { token: "", privateToken }).then((value: unknown) => {
      cached = value;
      // Nine public GitHub GETs per refresh: 15 minutes stays below the
      // anonymous 60-requests/hour allowance for a warm instance.
      expires = Date.now() + 900_000;
      return value;
    }).finally(() => { pending = null; });
    await pending;
  }
  return Response.json(cached, { headers });
};
