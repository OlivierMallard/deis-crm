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
const includes = { prospects:{convertedClient:{select:{id:true}}},clients:{_count:{select:{contracts:true}}},actions:{prospect:person},contracts:{client:person},quotes:{client:person,lines:{orderBy:{position:'asc'}}},invoices:{client:person,payments:true} };
type Row = Record<string,unknown>;
type Delegate = { findMany(args: object): Promise<Row[]>; count(args:object):Promise<number> };
export function csvCell(value: unknown) {
  let s=value instanceof Date?value.toISOString():String(value??'');
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
}
export function csv(rows: unknown[][]) { return '\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n'; }
async function invoiceIds(tx:Prisma.TransactionClient,paymentStatus:unknown, overdue:unknown, zone:string) {
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
  const parsed=parseList(kind,req.query);
  const result=await prisma.$transaction(async tx=>{
    if(kind==='invoices' && (parsed.paymentStatus!==undefined || parsed.overdue!==undefined)) parsed.where.id={in:await invoiceIds(tx,parsed.paymentStatus,parsed.overdue,parsed.zone)};
    const delegate=tx[models[kind]] as unknown as Delegate;
    const total=await delegate.count({where:parsed.where});
    if(exporting && total>10000) throw new ValidationError('Export limité à 10 000 lignes : affinez les filtres.');
    const rows=await delegate.findMany({where:parsed.where,include:includes[kind],orderBy:parsed.orderBy,skip:exporting?0:(parsed.page-1)*parsed.pageSize,take:exporting?10000:parsed.pageSize});
    const items: Row[]=kind==='invoices'?rows.map(r=>({...r,...settlement(r as unknown as Parameters<typeof settlement>[0],new Intl.DateTimeFormat('en-CA',{timeZone:parsed.zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))})):rows;
    return {items,total,page:parsed.page,pageSize:parsed.pageSize,totalPages:Math.ceil(total/parsed.pageSize)};
  },{isolationLevel:'RepeatableRead'});
  if(!exporting) { res.json(result); return; }
  const columns: Record<Kind,[string,string][]>={
    prospects:[['firstName','Prénom'],['lastName','Nom'],['company','Société'],['email','Email'],['phone','Téléphone'],['status','Statut'],['createdAt','Création']],
    clients:[['firstName','Prénom'],['lastName','Nom'],['company','Société'],['email','Email'],['phone','Téléphone'],['createdAt','Création']],
    actions:[['title','Titre'],['type','Type'],['prospectId','Prospect'],['dueAt','Échéance'],['completedAt','Terminé le']],
    contracts:[['reference','Référence'],['title','Titre'],['clientId','Client'],['status','Statut'],['amountCents','Montant HT (€)'],['signedAt','Signature']],
    quotes:[['reference','Référence'],['title','Titre'],['clientId','Client'],['status','Statut'],['issueDate','Date'],['totalExclTaxCents','Montant HT (€)']],
    invoices:[['reference','Référence'],['title','Titre'],['clientId','Client'],['status','Statut'],['issueDate','Émission'],['dueDate','Échéance'],['totalExclTaxCents','Montant HT (€)'],['totalInclTaxCents','Montant TTC (€)'],['paymentStatus','Règlement']]
  };
  res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${kind}.csv"`);
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
    output[kind]=await (prisma[models[kind]] as unknown as Delegate).findMany({where:{OR:fields.map(k=>({[k]:{contains:q,mode:'insensitive'}}))},select,take:8,orderBy:{id:'desc'}});
  }));
  res.json(output);
});
