import { Router } from 'express';
import { sendXlsx } from '../lib/exports.js';
import { prisma } from '../lib/prisma.js';
import { audit } from './auth.js';
import { parseList } from '../validation/lists.js';
import { ValidationError } from '../validation/prospects.js';
import { dateOnly } from '../validation/lists.js';
import { parseId } from '../validation/commerce.js';
import { invoiceIds, csv } from './discovery.js';
export const paymentExportRouter=Router();
paymentExportRouter.get('/payments/export',async(req,res)=>{
  const {format='csv',paidFrom,paidTo,invoiceId,...query}=req.query;
  const paymentInvoiceId=invoiceId===undefined?undefined:parseId(invoiceId);
  const from=paidFrom===undefined?undefined:dateOnly(paidFrom),to=paidTo===undefined?undefined:dateOnly(paidTo);
  if(from&&to&&from>to)throw new ValidationError('Période inversée.');
  if(!['csv','xlsx'].includes(String(format)))throw new ValidationError('Format invalide.');
  // Reuse invoice filters to export payments of the selected invoices, across all pages.
  const parsed=parseList('invoices',query);
  const rows=await prisma.$transaction(async tx=>{
    if(parsed.paymentStatus!==undefined||parsed.overdue!==undefined)parsed.where.id={in:await invoiceIds(tx,parsed.paymentStatus,parsed.overdue,parsed.zone)};
    const where={invoice:parsed.where,...(paymentInvoiceId===undefined?{}:{invoiceId:paymentInvoiceId}),...(from||to?{paidAt:{...(from?{gte:new Date(from)}:{}),...(to?{lte:new Date(to)}:{})}}:{})};
    if(await tx.payment.count({where})>10000)throw new ValidationError('Export limité à 10 000 lignes : affinez les filtres.');
    return tx.payment.findMany({where,include:{invoice:{include:{client:true}}},orderBy:[{paidAt:'desc'},{id:'desc'}],take:10000});
  },{isolationLevel:'RepeatableRead',timeout:60000});
  const headers=['Identifiant','Facture','Client','Date du règlement','Montant (€)','Mode','Référence'];
  const values=rows.map(r=>[r.id,r.invoice.reference,r.invoice.client.company??`${r.invoice.client.firstName} ${r.invoice.client.lastName}`,r.paidAt,r.amountCents/100,r.method,r.reference]);
  await audit(res.locals.auth.user.id,'EXPORT','payments',{filters:{...query,invoiceId:paymentInvoiceId??null,paidFrom:from??null,paidTo:to??null},format});
  const filename=`crm-deis-reglements-${new Date().toISOString().slice(0,10)}.${format}`;
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  if(format==='csv'){res.type('text/csv; charset=utf-8').send(csv([headers,...values.map(r=>r.map((v,i)=>i===4?Number(v).toFixed(2).replace('.',','):v))]));return;}
  await sendXlsx(res,filename,headers.map((header,i)=>({header,format:i===3?'date':i===4?'money':undefined})),values);
});
