import { env, errorResponse, requireAuth, response } from "../lib/platform.mts";

export default async req => {
  if(req.method!=="POST")return response({error:"Method not allowed"},405);
  try{
    const origin=req.headers.get("origin");
    if(origin&&origin!==new URL(req.url).origin)return response({error:"INVALID_ORIGIN"},403);
    const authorization=requireAuth(req);
    const base=env("GETACOURT_SUPABASE_URL").replace(/\/$/,"");
    const upstream=await fetch(base+"/auth/v1/logout",{
      method:"POST",
      headers:{"apikey":env("GETACOURT_SUPABASE_PUBLISHABLE_KEY"),authorization}
    });
    if(!upstream.ok)return response({error:"SIGNOUT_REVOKE_FAILED"},upstream.status>=500?502:upstream.status);
    return response({ok:true});
  }catch(error){return errorResponse(error);}
};
export const config={path:"/api/gac/auth/sign-out"};
