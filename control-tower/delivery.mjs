// Reviewed scope describes the pilot and future roadmap, never acceptance credit
// or an operational GO. Only the approved milestone evaluator earns percentages.
const text = (value, limit=400) => typeof value==='string' && value.length<=limit ? value : null;
const rows = (value, limit) => (Array.isArray(value)?value:[]).slice(0,limit)
  .filter(row=>text(row?.name,120)&&text(row?.scope))
  .map(row=>({name:row.name,scope:row.scope,gate:text(row.gate),owner:text(row.owner,120),
    status:'UNKNOWN',progress:null}));

export function deliveryScope(review, definition, milestones) {
  const input=review?.delivery;
  if(!input||definition?.kind!=='product')return null;
  const blockers=(Array.isArray(input.blockers)?input.blockers:[]).slice(0,4)
    .filter(row=>text(row?.name,180)).map(row=>({name:row.name,owner:text(row.owner,120),go:text(row.go,200)}));
  return {pilotGoal:text(input.pilotGoal),nextGate:text(input.nextGate),blockers,
    // A known failed gate proves NOT ready. No human overlay can grant READY,
    // and even 100% source acceptance does not authorise a working/live launch.
    launchStatus:milestones.some(m=>['FAILED','BLOCKED'].includes(m.acceptance))?'BLOCKED':'UNKNOWN',
    launchApproved:false,active:rows(input.active,8),future:rows(input.future,12),
    sourceLinks:(Array.isArray(input.sourceLinks)?input.sourceLinks:[]).slice(0,5)
      .filter(link=>text(link?.title,140)&&text(link?.url,500)).map(link=>({title:link.title,url:link.url}))};
}
