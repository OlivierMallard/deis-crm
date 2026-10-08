import { Router } from 'express';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { dateOnly, localBounds, textQuery } from '../validation/lists.js';
import { dayBounds } from '../validation/actions.js';
import { ValidationError } from '../validation/prospects.js';

export const reportsRouter=Router();
export function reportPeriod(query: Record<string,unknown>) {
  if(Object.keys(query).some(k=>!['from','to','timeZone'].includes(k))) throw new ValidationError('Paramètre de période inconnu.');
  const zone=query.timeZone===undefined?'UTC':textQuery(query.timeZone,'timeZone'); dayBounds(zone);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=(k:string)=>parts.find(p=>p.type===k)!.value;
  const today=`${get('year')}-${get('month')}-${get('day')}`;
  const from=query.from===undefined?today.slice(0,7)+'-01':dateOnly(query.from), to=query.to===undefined?today:dateOnly(query.to);
  if(from>to || new Date(to).getTime()-new Date(from).getTime()>3*366*86400000) throw new ValidationError('Période inversée ou supérieure à trois ans.');
  return {from,to,zone,start:localBounds(from,zone).start,end:localBounds(to,zone).end,dateStart:new Date(from),dateEnd:new Date(new Date(to).getTime()+86400000)};
}
export const conversionRate=(converted:number,created:number)=>created?converted/created*100:0;
reportsRouter.get('/overview',async(req,res)=>{
  const p=reportPeriod(req.query), createdAt={gte:p.start,lt:p.end};
  const result=await prisma.$transaction(async tx=>{
    const [created,contacted,qualified,converted,clients,contracts,quotes,invoices,payments,completed,overdue]=await Promise.all([
      tx.prospect.count({where:{createdAt}}),
      tx.prospect.count({where:{createdAt,status:'CONTACTED'}}),
      tx.prospect.count({where:{createdAt,status:'QUALIFIED'}}),
      tx.prospect.count({where:{createdAt,convertedClient:{isNot:null}}}),
      tx.client.count({where:{createdAt}}),
      tx.contract.aggregate({where:{signedAt:{gte:p.start,lt:p.end},status:{in:['SIGNED','IN_PROGRESS','COMPLETED']}},_count:true,_sum:{amountCents:true}}),
      tx.quote.aggregate({where:{issueDate:{gte:p.dateStart,lt:p.dateEnd},status:'SENT'},_sum:{totalExclTaxCents:true}}),
      tx.invoice.aggregate({where:{issueDate:{gte:p.dateStart,lt:p.dateEnd},status:'ISSUED'},_sum:{totalExclTaxCents:true}}),
      tx.payment.aggregate({where:{paidAt:{gte:p.dateStart,lt:p.dateEnd}},_sum:{amountCents:true}}),
      tx.action.count({where:{completedAt:{gte:p.start,lt:p.end}}}),
      tx.action.count({where:{completedAt:null,dueAt:{lt:dayBounds(p.zone).start}}})
    ]);
    return {prospectsCreated:created,prospectsCurrentlyContacted:contacted,prospectsCurrentlyQualified:qualified,cohortConverted:converted,conversionRate:conversionRate(converted,created),clientsCreated:clients,contractsSigned:contracts._count,signedExclTaxCents:contracts._sum.amountCents??0,sentQuotesExclTaxCents:quotes._sum.totalExclTaxCents??0,invoicedExclTaxCents:invoices._sum.totalExclTaxCents??0,receivedInclTaxCents:payments._sum.amountCents??0,actionsCompleted:completed,actionsCurrentlyOverdue:overdue};
  },{isolationLevel:'RepeatableRead'});
  res.json({period:{from:p.from,to:p.to,timeZone:p.zone},...result});
});
reportsRouter.get('/pipeline',async(req,res)=>{
  reportPeriod(req.query);
  const [prospects,contracts]=await prisma.$transaction([prisma.prospect.groupBy({by:['status'],_count:true}),prisma.contract.groupBy({by:['status'],_count:true,_sum:{amountCents:true}})],{isolationLevel:'RepeatableRead'});
  res.json({prospects,contracts});
});
reportsRouter.get('/monthly',async(req,res)=>{
  const p=reportPeriod(req.query);
  const data=await prisma.$queryRaw<{month:string;metric:string;value:bigint}[]>(Prisma.sql`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${p.zone},'YYYY-MM') AS "month",'prospectsCreated' AS metric,count(*)::bigint AS value FROM "Prospect" WHERE "createdAt">=${p.start} AND "createdAt"<${p.end} GROUP BY 1
    UNION ALL SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${p.zone},'YYYY-MM'),'clientsCreated',count(*)::bigint FROM "Client" WHERE "createdAt">=${p.start} AND "createdAt"<${p.end} GROUP BY 1
    UNION ALL SELECT to_char(("signedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${p.zone},'YYYY-MM'),'signedExclTaxCents',sum("amountCents")::bigint FROM "Contract" WHERE "signedAt">=${p.start} AND "signedAt"<${p.end} AND status IN ('SIGNED','IN_PROGRESS','COMPLETED') GROUP BY 1
    UNION ALL SELECT to_char("issueDate",'YYYY-MM'),'invoicedExclTaxCents',sum("totalExclTaxCents")::bigint FROM "Invoice" WHERE "issueDate">=${p.dateStart} AND "issueDate"<${p.dateEnd} AND status='ISSUED' GROUP BY 1
    UNION ALL SELECT to_char("paidAt",'YYYY-MM'),'receivedInclTaxCents',sum("amountCents")::bigint FROM "Payment" WHERE "paidAt">=${p.dateStart} AND "paidAt"<${p.dateEnd} GROUP BY 1`);
  const months: Record<string,Record<string,string|number>>={};
  const cursor=new Date(p.from.slice(0,7)+'-01');
  while(cursor.toISOString().slice(0,7)<=p.to.slice(0,7)) { const month=cursor.toISOString().slice(0,7);months[month]={month,prospectsCreated:0,clientsCreated:0,signedExclTaxCents:0,invoicedExclTaxCents:0,receivedInclTaxCents:0};cursor.setUTCMonth(cursor.getUTCMonth()+1); }
  for(const row of data) if(months[row.month]) months[row.month][row.metric]=Number(row.value);
  res.json(Object.values(months));
});

const goalPath=resolve(process.env.REPORTING_GOAL_FILE??'data/reporting-goal.json');
let writing=Promise.resolve();
async function storeGoal(value:number) {
  await mkdir(dirname(goalPath),{recursive:true});const temporary=goalPath+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify({monthlyExclTaxCents:value})+'\n','utf8');await rename(temporary,goalPath);
}
export async function readGoal() {
  try { const value=JSON.parse(await readFile(goalPath,'utf8')); if(!Number.isInteger(value.monthlyExclTaxCents) || value.monthlyExclTaxCents<0 || value.monthlyExclTaxCents>2147483647) throw new Error('Objectif enregistré invalide.');return value.monthlyExclTaxCents as number; }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    const job=writing.then(async()=>{try{await readFile(goalPath,'utf8')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await storeGoal(500000)}});
    writing=job.catch(()=>{});await job;return readGoal();
  }
}
reportsRouter.put('/goal',async(req,res)=>{
  if(!req.body || Object.keys(req.body).length!==1 || !Number.isInteger(req.body.monthlyExclTaxCents) || req.body.monthlyExclTaxCents<0 || req.body.monthlyExclTaxCents>2147483647) throw new ValidationError('monthlyExclTaxCents : montant entier positif en centimes attendu.');
  const value=req.body.monthlyExclTaxCents;
  const job=writing.then(()=>storeGoal(value));
  writing=job.catch(()=>{});await job;res.json({monthlyExclTaxCents:value});
});
reportsRouter.get('/goal',async(req,res)=>{
  const p=reportPeriod(req.query),month=p.from.slice(0,7),start=new Date(month+'-01'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+1);
  const [goal,sum]=await Promise.all([readGoal(),prisma.invoice.aggregate({where:{status:'ISSUED',issueDate:{gte:start,lt:end}},_sum:{totalExclTaxCents:true}})]);
  const invoiced=sum._sum.totalExclTaxCents??0;
  res.json({month,monthlyExclTaxCents:goal,invoicedExclTaxCents:invoiced,achievementPercent:goal?invoiced/goal*100:null,remainingExclTaxCents:Math.max(0,goal-invoiced)});
});
