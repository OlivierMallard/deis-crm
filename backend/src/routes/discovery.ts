import { sendXlsx } from '../lib/exports.js';
import { audit, admin } from './auth.js';
import { parseId } from '../validation/commerce.js';
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { kinds, parseList, textQuery, type Kind } from '../validation/lists.js';
import { ValidationError } from '../validation/prospects.js';
import { settlement } from '../validation/finance.js';
import { dayBounds } from '../validation/actions.js';

export const discoveryRouter = Router();
const models = { prospects:'prospect',clients:'client',actions:'action',contracts:'contract',quotes:'quote',invoices:'invoice' } as const;
const person = { select:{id:true,firstName:true,lastName:true,company:true} };
const includes = { prospects:{convertedClient:{select:{id:true}}},clients:{_count:{select:{contracts:true,quotes:true,invoices:true}}},actions:{prospect:person},contracts:{client:person},quotes:{client:person,lines:{orderBy:{position:'asc'}}},invoices:{client:person,payments:true} };
type Row = Record<string,unknown>;
type Delegate = { findMany(args: object): Promise<Row[]>; count(args:object):Promise<number> };
export function csvCell(value: unknown) {
  let s=value instanceof Date?value.toISOString():String(value??'');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csv(rows: unknown[][]) { return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n'; }
export async function invoiceIds(tx:Prisma.TransactionClient,paymentStatus:unknown, overdue:unknown, zone:string) {
  const paid=Prisma.sql`COALESCE((SELECT SUM(p."amountCents") FROM "Payment" p WHERE p."invoiceId"=i.id),0)`;
  const conditions: Prisma.Sql[]=[];
  if(paymentStatus==='UNPAID') conditions.push(Prisma.sql`${paid}=0`);
  if(paymentStatus==='PAID') conditions.push(Prisma.sql`${paid}=i."totalInclTaxCents" AND ${paid}>0`);
  if(paymentStatus==='PARTIAL') conditions.push(Prisma.sql`${paid}>0 AND ${paid}<i."totalInclTaxCents"`);
  if(overdue!==undefined) {
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(dayBounds(zone).start);
    const late=Prisma.sql`(i.status='ISSUED' AND ${paid}<i."totalInclTaxCents" AND i."dueDate"<${new Date(today)})`;
    conditions.push(overdue==='true'?late:Prisma.sql`NOT ${late}`);
  }
  const result=await tx.$queryRaw<{id:number}[]>(Prisma.sql`SELECT i.id FROM "Invoice" i WHERE ${Prisma.join(conditions,' AND ')}`);
  return result.map(r=>r.id);
}
for(const kind of kinds) for(const exporting of [false,true]) discoveryRouter.get(`/${kind}${exporting?'/export':''}`,async(req,res)=>{
  const {format: requestedFormat,...query}=req.query;
  if(requestedFormat!==undefined && (!exporting || !['csv','xlsx'].includes(String(requestedFormat)))) throw new ValidationError('Format invalide.');
  const parsed=parseList(kind,query);
  const result=await prisma.$transaction(async tx=>{
    if(kind==='invoices' && (parsed.paymentStatus!==undefined || parsed.overdue!==undefined)) parsed.where.id={in:await invoiceIds(tx,parsed.paymentStatus,parsed.overdue,parsed.zone)};
    const delegate=tx[models[kind]] as unknown as Delegate;
    const total=await delegate.count({where:parsed.where});
    if(exporting && total>10000) throw new ValidationError('Export limité à 10 000 lignes : affinez les filtres.');
    const rows=await delegate.findMany({where:parsed.where,include:exporting&&kind==='quotes'?{client:person}:includes[kind],orderBy:parsed.orderBy,skip:exporting?0:(parsed.page-1)*parsed.pageSize,take:exporting?10000:parsed.pageSize});
    const items: Row[]=kind==='invoices'?rows.map(r=>({...r,...settlement(r as unknown as Parameters<typeof settlement>[0],new Intl.DateTimeFormat('en-CA',{timeZone:parsed.zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))})):rows;
    if(exporting && items.length && kind==='clients') {
      const totals=await tx.$queryRaw<{id:number;billed:bigint;paid:bigint;remaining:bigint}[]>(Prisma.sql`SELECT i."clientId" AS id, SUM(i."totalExclTaxCents")::bigint AS billed, SUM(p.paid)::bigint AS paid, SUM(i."totalInclTaxCents"-p.paid)::bigint AS remaining FROM "Invoice" i CROSS JOIN LATERAL (SELECT COALESCE(SUM("amountCents"),0) AS paid FROM "Payment" WHERE "invoiceId"=i.id) p WHERE i.status='ISSUED' AND i."clientId" IN (${Prisma.join(items.map(r=>Number(r.id)))}) GROUP BY i."clientId"`);
      const byId=new Map(totals.map(r=>[r.id,r]));
      for(const row of items) {
        const total=byId.get(Number(row.id)),counts=row._count as Record<string,number>;
        Object.assign(row,{billedCents:Number(total?.billed??0),paidCents:Number(total?.paid??0),remainingCents:Number(total?.remaining??0),quoteCount:counts.quotes,contractCount:counts.contracts,invoiceCount:counts.invoices});
      }
    }
    if(exporting && items.length && kind==='prospects') {
      const actions=await tx.$queryRaw<{id:number;lastAction:string;nextFollowUp:Date|null}[]>(Prisma.sql`SELECT p.id, (SELECT a.title FROM "Action" a WHERE a."prospectId"=p.id ORDER BY a."createdAt" DESC,a.id DESC LIMIT 1) AS "lastAction", (SELECT MIN(a."dueAt") FROM "Action" a WHERE a."prospectId"=p.id AND a."completedAt" IS NULL) AS "nextFollowUp" FROM "Prospect" p WHERE p.id IN (${Prisma.join(items.map(r=>Number(r.id)))})`);
      const byId=new Map(actions.map(r=>[r.id,r]));
      for(const row of items) Object.assign(row,byId.get(Number(row.id)));
    }
    return {items,total,page:parsed.page,pageSize:parsed.pageSize,totalPages:Math.ceil(total/parsed.pageSize)};
  },{isolationLevel:'RepeatableRead',timeout:exporting?60000:5000});
  if(!exporting) { res.json(result); return; }
  for(const row of result.items) {
    if(row.client){const client=row.client as Record<string,unknown>;row.clientName=client.company||`${client.firstName} ${client.lastName}`;}
    if(kind==='invoices' && row.status!=='ISSUED')row.remainingCents=0;
  }
  const columns: Record<Kind,[string,string][]>={
    prospects:[['id','Identifiant'],['firstName','Prénom'],['lastName','Nom'],['company','Société'],['email','Email'],['phone','Téléphone'],['status','Statut'],['createdAt','Création'],['updatedAt','Modification'],['lastAction','Dernière action'],['nextFollowUp','Prochaine relance'],['notes','Notes']],
    clients:[['id','Identifiant'],['firstName','Prénom'],['lastName','Nom'],['company','Société'],['email','Email'],['phone','Téléphone'],['createdAt','Création'],['quoteCount','Devis'],['contractCount','Contrats'],['invoiceCount','Factures'],['billedCents','Facturé HT (€)'],['paidCents','Réglé TTC (€)'],['remainingCents','Solde TTC (€)']],
    actions:[['title','Titre'],['type','Type'],['prospectId','Prospect'],['dueAt','Échéance'],['completedAt','Terminé le']],
    contracts:[['reference','Référence'],['title','Titre'],['clientName','Client'],['status','Statut'],['amountCents','Montant HT (€)'],['signedAt','Signature']],
    quotes:[['reference','Référence'],['title','Titre'],['clientName','Client'],['status','Statut'],['issueDate','Date'],['totalExclTaxCents','Montant HT (€)']],
    invoices:[['reference','Référence'],['title','Titre'],['clientName','Client'],['status','Statut'],['issueDate','Émission'],['dueDate','Échéance'],['totalExclTaxCents','Montant HT (€)'],['vatCents','TVA (€)'],['totalInclTaxCents','Montant TTC (€)'],['paidCents','Montant réglé (€)'],['remainingCents','Solde TTC (€)'],['paymentStatus','Règlement']]
  };
  await audit(res.locals.auth.user.id,'EXPORT',kind,{filters:query,format:requestedFormat??'csv'});
  const filename=`crm-deis-${({prospects:'prospects',clients:'clients',invoices:'factures'} as Record<string,string>)[kind]??kind}-${new Date().toISOString().slice(0,10)}`;
  if(requestedFormat==='xlsx') {
    await sendXlsx(res,`${filename}.xlsx`,columns[kind].map(([key,header])=>({header,format:key.endsWith('Cents')?'money':result.items.some(r=>r[key] instanceof Date)?'date':undefined})),result.items.map(row=>columns[kind].map(([key])=>key.endsWith('Cents')?Number(row[key])/100:row[key])));
    return;
  }
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${filename}.csv"`);
  res.send(csv([columns[kind].map(c=>c[1]),...result.items.map(r=>columns[kind].map(([key])=>key.endsWith('Cents')?(Number(r[key])/100).toFixed(2).replace('.',','):r[key]))]));
});
discoveryRouter.get('/search',async(req,res)=>{
  if(Object.keys(req.query).some(k=>k!=='q')) throw new ValidationError('Paramètre de recherche inconnu.');
  const q=textQuery(req.query.q??'','q',100);
  const output: Record<string,unknown>={};
  await Promise.all(kinds.filter(k=>k!=='actions').map(async kind=>{
    if(!q) {output[kind]=[];return;}
    const fields=['prospects','clients'].includes(kind)?['firstName','lastName','company','email','phone']:['reference','title'];
    const select=['prospects','clients'].includes(kind)?{id:true,firstName:true,lastName:true,company:true}:{id:true,reference:true,title:true};
    output[kind]=await (prisma[models[kind]] as unknown as Delegate).findMany({where:{...(['prospects','clients'].includes(kind)?{archivedAt:null}:{}),OR:fields.map(k=>({[k]:{contains:q,mode:'insensitive'}}))},select,take:8,orderBy:{id:'desc'}});
  }));
  res.json(output);
});

for(const kind of ['prospects','clients'] as const) discoveryRouter.post(`/${kind}/:id/archive`,admin,async(req,res)=>{
  if(typeof req.body?.archived!=='boolean')throw new ValidationError('archived : booléen attendu.');
  const id=parseId(req.params.id),archivedAt=req.body.archived?new Date():null;
  const row=await prisma.$transaction(async tx=>{
    const data=kind==='prospects'?await tx.prospect.update({where:{id},data:{archivedAt}}):await tx.client.update({where:{id},data:{archivedAt}});
    await tx.auditLog.create({data:{userId:res.locals.auth.user.id,action:archivedAt?'ARCHIVE':'RESTORE',target:`${kind}/${id}`}});return data;
  });res.json(row);
});
