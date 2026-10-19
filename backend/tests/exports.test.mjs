import './legacy-auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { prisma } from '../dist/lib/prisma.js';
import { app } from '../dist/app.js';
test('PostgreSQL exports: client totals, all pages, payment dates, archives and data unchanged',{skip:process.env.TEST_DATABASE!=='1'},async()=>{
 const tag='M10-'+randomUUID();let client,prospect;const invoices=[];
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
 const get=path=>fetch(base+path);
 try{
  client=await prisma.client.create({data:{firstName:tag,lastName:'Export'}});
  prospect=await prisma.prospect.create({data:{firstName:tag,lastName:'Prospect',notes:'=sensitive-formula'}});
  await prisma.action.create({data:{prospectId:prospect.id,type:'CALL',title:'Follow up',dueAt:new Date('2026-10-22T10:00:00Z')}});
  for(const status of ['ISSUED','DRAFT','CANCELLED'])invoices.push(await prisma.invoice.create({data:{clientId:client.id,reference:tag+'-'+status,title:'Test export',issueDate:new Date('2026-10-19'),dueDate:new Date('2026-11-19'),status,totalExclTaxCents:10000,vatRateBasisPoints:2000,vatCents:2000,totalInclTaxCents:12000}}));
  await prisma.payment.create({data:{invoiceId:invoices[0].id,amountCents:3000,paidAt:new Date('2026-10-20'),method:'BANK_TRANSFER',reference:'=1+1'}});
  const before=JSON.stringify(await prisma.invoice.findMany({where:{clientId:client.id},include:{payments:true},orderBy:{id:'asc'}}));
  const response=await get(`/clients/export?format=xlsx&q=${tag}&page=2&pageSize=1`);assert.equal(response.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await response.arrayBuffer()));const sheet=book.worksheets[0],headers=sheet.getRow(1).values;const val=name=>sheet.getCell(2,headers.indexOf(name)).value;
  assert.equal(sheet.rowCount,2);assert.equal(val('Factures'),3);assert.equal(val('Facturé HT (€)'),100);assert.equal(val('Réglé TTC (€)'),30);assert.equal(val('Solde TTC (€)'),90);
  const invoiceResponse=await get(`/invoices/export?format=xlsx&clientId=${client.id}`);assert.equal(invoiceResponse.status,200);
  const invoiceBook=new ExcelJS.Workbook();await invoiceBook.xlsx.load(Buffer.from(await invoiceResponse.arrayBuffer()));const invoiceSheet=invoiceBook.worksheets[0],invoiceHeaders=invoiceSheet.getRow(1).values;
  invoiceSheet.eachRow((row,index)=>{if(index>1)assert.equal(row.getCell(invoiceHeaders.indexOf('Solde TTC (€)')).value,row.getCell(invoiceHeaders.indexOf('Statut')).value==='ISSUED'?90:0)});
  const csv=await (await get(`/prospects/export?q=${tag}`)).text();assert.match(csv,/'=sensitive-formula/);assert.match(csv,/Follow up/);
  const payments=await (await get(`/payments/export?clientId=${client.id}&paidFrom=2026-10-20&paidTo=2026-10-20`)).text();assert.match(payments,/'=1\+1/);assert.match(payments,/30,00/);
  const empty=await (await get(`/payments/export?clientId=${client.id}&paidFrom=2026-10-21`)).text();assert.doesNotMatch(empty,/'=1\+1/);
  const archive=await fetch(base+`/prospects/${prospect.id}/archive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:true})});assert.equal(archive.status,200);
  assert.equal((await (await get(`/prospects?q=${tag}`)).json()).total,0);assert.equal((await (await get(`/prospects?q=${tag}&archived=true`)).json()).total,1);
  const restore=await fetch(base+`/prospects/${prospect.id}/archive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({archived:false})});assert.equal(restore.status,200);
  assert.equal(JSON.stringify(await prisma.invoice.findMany({where:{clientId:client.id},include:{payments:true},orderBy:{id:'asc'}})),before);
 }finally{
  if(client){await prisma.payment.deleteMany({where:{invoice:{clientId:client.id}}});await prisma.invoice.deleteMany({where:{clientId:client.id}});await prisma.client.delete({where:{id:client.id}})}
  if(prospect){await prisma.action.deleteMany({where:{prospectId:prospect.id}});await prisma.prospect.delete({where:{id:prospect.id}})}
  await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();
 }
});
