import { body, env, errorResponse, response } from "../lib/platform.mts";

const validCode = code => typeof code === "string" && /^[0-9a-fA-F-]{16,128}$/.test(code);
const validVerifier = value => typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

export default async (req) => {
  if(req.method !== "POST")return response({error:"Method not allowed"},405);
  try {
    const origin=req.headers.get("origin");
    if(origin&&origin!==new URL(req.url).origin)return response({error:"INVALID_ORIGIN"},403);
    if(String(globalThis.Netlify?.env?.get("GETACOURT_GOOGLE_SIGNIN_ENABLED")||"").toLowerCase()!=="true")
      return response({error:"GOOGLE_SIGNIN_DISABLED"},503);
    const input=await body(req);
    if(!validCode(input.authCode)||!validVerifier(input.codeVerifier))
      return response({error:"INVALID_OAUTH_CODE",message:"Invalid OAuth authorization data."},400);
    const base=env("GETACOURT_SUPABASE_URL").replace(/\/$/,"");
    const key=env("GETACOURT_SUPABASE_PUBLISHABLE_KEY");
    const upstream=await fetch(base+"/auth/v1/token?grant_type=pkce",{
      method:"POST",
      headers:{"apikey":key,"content-type":"application/json"},
      body:JSON.stringify({auth_code:input.authCode,code_verifier:input.codeVerifier})
    });
    let data={};try{data=await upstream.json();}catch{}
    if(!upstream.ok)return response({error:"OAUTH_EXCHANGE_FAILED",message:"Google authorization could not be completed."},upstream.status>=500?502:401);
    if(!data.access_token||!data.refresh_token)
      return response({error:"OAUTH_SESSION_MISSING"},502);
    // Return only GetACourt Supabase session credentials, never Google provider tokens.
    return response({
      access_token:data.access_token,refresh_token:data.refresh_token,
      expires_in:data.expires_in,token_type:data.token_type
    });
  } catch(error) {return errorResponse(error);}
};

export const config = {path:"/api/gac/auth/google/exchange"};
