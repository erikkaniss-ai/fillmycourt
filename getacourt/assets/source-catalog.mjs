// Reviewed public directory metadata, NOT availability or provider authority.
// No account IDs, personal observations, prices or coordinates are stored here.
export const SOURCES = Object.freeze([
  {id:'core', label:'FillMyCourt / Core'},
  {id:'playtomic', label:'Playtomic'},
  {id:'tiesports', label:'TieSports / TiePlayer'},
  {id:'racket_id', label:'Racket ID'},
  {id:'smashpro', label:'Smashpro'},
  {id:'matchi', label:'MATCHi'},
  {id:'club_internal', label:'Club internal systems'}
].map(Object.freeze));
const records = [
  {id:'pt-cascais-padel-nature', name:'Cascais Padel & Nature', area:'Cascais',
   areas:['cascais','lisboa','lisbon'], sports:['padel'],
   sources:[{id:'playtomic', url:'https://playtomic.com/clubs/cascais-padel-club', kind:'club_page', reviewedOn:'2026-10-24'}]},
  {id:'pt-rackets-pro-quinta-marinha', name:'Rackets Pro Academy — Quinta da Marinha', area:'Cascais',
   areas:['cascais','quinta da marinha','lisboa','lisbon'], sports:['padel','tennis'],
   website:'https://www.racketspro.pt/quinta-da-marinha',
   sources:[
     {id:'racket_id', url:'https://racket.id/booking', kind:'player_portal', reviewedOn:'2026-10-25'},
     {id:'smashpro', url:'https://smashpro.pt/pt/c/rackets-pro-academy-quinta-da-marinha', kind:'unclaimed_listing', reviewedOn:'2026-10-25'}]},
  {id:'pt-padel-factory-lisboa', name:'Padel Factory', area:'Lisboa',
   areas:['lisboa','lisbon','alto da bela vista'], sports:['padel'],
   sources:[{id:'tiesports',url:'https://clubs.tiesports.com/en/lisboa/PadelFactory',kind:'club_page',reviewedOn:'2026-10-25'}]},
  {id:'pt-opa-oeiras', name:'OPA OEIRAS', area:'Oeiras',
   areas:['oeiras','lisboa','lisbon'], sports:['padel','pickleball'],
   sources:[{id:'tiesports', url:'https://clubs.tiesports.com/en/lisboa/OeirasPadelAcademy', kind:'club_page', reviewedOn:'2026-10-25'}]}
];
export const CLUBS = Object.freeze(records.map(c => Object.freeze({...c,
  areas:Object.freeze(c.areas), sports:Object.freeze(c.sports),
  sources:Object.freeze(c.sources.map(Object.freeze))
})));
export function fold(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
export function directoryMatches(query) {
  const location=fold(query.location);
  return CLUBS.filter(c=>c.sports.includes(query.sport) &&
    (c.areas.some(a=>fold(a)===location) || fold(c.name)===location));
}
export function safeSourceUrl(sourceId, value) {
  try {
    const u=new URL(value);
    if(u.protocol!=='https:' || u.username || u.password || u.port || u.search || u.hash) return null;
    const rules={
      playtomic:()=>u.hostname==='playtomic.com' && /^\/clubs\/[a-z0-9-]+\/?$/.test(u.pathname),
      tiesports:()=>u.hostname==='clubs.tiesports.com' && /^\/(en|pt)\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/?$/.test(u.pathname),
      racket_id:()=>u.hostname==='racket.id' && u.pathname==='/booking',
      smashpro:()=>u.hostname==='smashpro.pt' && /^\/pt\/c\/[a-z0-9-]+$/.test(u.pathname),
      matchi:()=>u.hostname==='www.matchi.se' && /^\/facilities\/[a-z0-9_-]+$/.test(u.pathname),
      club_website:()=>u.hostname==='www.racketspro.pt' && u.pathname==='/quinta-da-marinha'
    };
    return rules[sourceId]?.() ? u.href : null;
  } catch { return null; }
}
