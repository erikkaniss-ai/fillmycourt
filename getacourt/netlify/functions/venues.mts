import type { Config } from '@netlify/functions';
import { venueSeeds } from './lib/data.js';

export default async () => Response.json({venues:venueSeeds.map(({basePrice,times,...v})=>({...v,live:false}))});
export const config: Config = { path:'/api/venues' };
