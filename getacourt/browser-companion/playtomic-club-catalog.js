// Short, human-reviewed official first-party Playtomic club-page routes.
// Area names are an explicit BOUNDED lookup, not a crawl/discovery API.
// No passwords, sessions, cookies, prices, inventory or time slots stored.
(function(root){
  "use strict";
  const records=[
    {id:"cascais-padel-nature",name:"Cascais Padel & Nature",
     sourceUrl:"https://playtomic.com/clubs/cascais-padel-club",
     areas:["cascais","alcabideche"],sports:["Padel"]},
    {id:"sports-club-cascais",name:"Sports Club Cascais",
     sourceUrl:"https://playtomic.com/clubs/sports-club-cascais",
     areas:["cascais","alcabideche"],sports:["Padel"]},
    {id:"padel-set-parede",name:"Padel Set Club Parede",
     sourceUrl:"https://playtomic.com/clubs/padel-set-club-parede",
     areas:["cascais","parede"],sports:["Padel"]},
    {id:"quinta-dos-lombos-padel",name:"Quinta dos Lombos Padel",
     sourceUrl:"https://playtomic.com/clubs/quinta-dos-lombos-padel",
     areas:["cascais","carcavelos"],sports:["Padel"]}
  ];
  const fold=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const clubs=Object.freeze(records.map(r=>Object.freeze({...r,
    areas:Object.freeze([...r.areas]),sports:Object.freeze([...r.sports])})));
  function matching(query){
    if(!query||typeof query.location!=="string"||query.location.length>80||
      !["Padel","Tennis"].includes(query.sport))return Object.freeze([]);
    const location=fold(query.location);
    if(!location)return Object.freeze([]);
    return Object.freeze(clubs.filter(c=>c.sports.includes(query.sport)&&
      (c.areas.includes(location)||fold(c.name)===location)).slice(0,4));
  }
  root.GetACourtPlaytomicClubCatalog=Object.freeze({matching,clubs});
  if(typeof module!=="undefined")module.exports=root.GetACourtPlaytomicClubCatalog;
})(globalThis);
