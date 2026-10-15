export function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function body(req) {
  try { return await req.json(); } catch { return {}; }
}

export function env(name) {
  const value = globalThis.Netlify?.env?.get(name);
  if (!value) throw new Error(name + " is not configured");
  return value;
}

export function coreBase() {
  return env("GETACOURT_CORE_API_BASE").replace(/\/$/, "");
}

export async function coreJson(path, init = {}, incomingReq = null) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (incomingReq) {
    const auth = incomingReq.headers.get("authorization");
    if (auth) headers.set("authorization", auth);
  }
  const res = await fetch(coreBase() + path, { ...init, headers });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.message || data.error || ("Core request failed (" + res.status + ")"));
    err.status = res.status;
    err.code = data.error || "CORE_ERROR";
    throw err;
  }
  return data;
}

export function errorResponse(error) {
  const status = Number(error?.status) || 502;
  return response({ error: error?.code || "UPSTREAM", message: error?.message || "Upstream service unavailable" }, status);
}

export function requireAuth(req) {
  const auth = req.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    const error = new Error("Sign in is required.");
    error.status = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  return auth;
}

export function idempotency(req) {
  return req.headers.get("idempotency-key") || crypto.randomUUID();
}
