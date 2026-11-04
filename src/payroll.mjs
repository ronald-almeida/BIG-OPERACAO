export function monthBounds(month){const [y,m]=month.split('-').map(Number);return [Date.parse(month+'-01T00:00:00-03:00'),Date.UTC(y,m,1,3)];}
export function hoursWithin(state,id,a,b,now){
  const overlap=(start,end)=>Math.max(0,Math.min(end,b,now)-Math.max(start,a));
  let ms=state.journal.filter(j=>j.employee===id).reduce((sum,j)=>sum+(j.end>j.start?j.duration*overlap(j.start,j.end)/(j.end-j.start):0),0);
  const s=state.sessions[id];if(s&&['active','pending'].includes(s.status))ms+=overlap(s.windowStart??s.start,s.status==='pending'?s.pending:Math.min(now,s.due));
  return ms/3600000;
}
export function payroll(state,id,month,now){
  const plan=state.people.find(p=>p.id===id)?.payPlans[month]??null,[a,b]=monthBounds(month),hours=hoursWithin(state,id,a,b,now),rate=plan?plan.fixed/plan.hours:0,normalHours=plan?Math.min(hours,plan.hours):0,extra=plan?Math.max(0,hours-plan.hours):0,overtimeRate=plan?.overtimeRate??null,overtimePending=extra>1e-9&&overtimeRate===null,normalAmount=normalHours*rate,extraAmount=overtimePending?null:extra*(overtimeRate||0);
  return {plan,hours,normalHours,billable:normalHours,rate,normalAmount,extra,overtimeRate,overtimePending,extraAmount,amount:normalAmount+(extraAmount||0),remaining:plan?Math.max(0,plan.hours-normalHours):0,progress:plan?Math.min(100,normalHours/plan.hours*100):0};
}
