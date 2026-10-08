import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { quoteInput, invoiceInput, paymentInput, settlement, totals } from '../dist/validation/finance.js';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';
const q = { clientId: 1, title: 'Mission 8', issueDate: '2026-10-08', lines: [{ description: 'Site', quantity: '1', unitPriceCents: 100000 },{ description: 'Automation', quantity:'1', unitPriceCents:50000, vatRateBasisPoints:2000 }] };
const inv = { clientId: 1, title:'Internal', issueDate:'2026-01-01',dueDate:'2026-01-02',totalExclTaxCents:10000 };
test('exact mixed VAT, decimal quantities, half-up rounding and historical rates', () => {
  const result = quoteInput(q); assert.equal(result.totalExclTaxCents,150000); assert.equal(result.vatCents,10000); assert.equal(result.totalInclTaxCents,160000); assert.equal(result.lines[0].vatRateBasisPoints,0);
  for(const [quantity,price,ht,tax] of [['0.5',1,1,0],['1.25',10,13,3],['0.0001',5000,1,0],['2.5',1,3,1]]) { const r=quoteInput({ ...q,lines:[{description:'fraction',quantity,unitPriceCents:price,vatRateBasisPoints:2000}] }); assert.equal(r.totalExclTaxCents,ht); assert.equal(r.vatCents,tax); }
  assert.equal(invoiceInput(inv).vatRateBasisPoints,0); assert.equal(invoiceInput({...inv,vatRateBasisPoints:2000}).totalInclTaxCents,12000);
  assert.equal(JSON.parse(JSON.stringify(result.lines))[1].vatRateBasisPoints,2000);
});
test('strict financial validation and derived settlement/overdue', () => {
  for(const rate of [null,-1,1000,20,'2000']) { assert.throws(()=>invoiceInput({...inv,vatRateBasisPoints:rate})); assert.throws(()=>quoteInput({...q,lines:[{...q.lines[0],vatRateBasisPoints:rate}]})); }
  for(const changes of [{totalExclTaxCents:-1},{totalExclTaxCents:0.1},{vatCents:1},{totalInclTaxCents:1},{dueDate:'2026-02-30'},{dueDate:'2025-01-01'},{status:'BAD'},{extra:true}]) assert.throws(()=>invoiceInput({...inv,...changes}));
  for(const quantity of ['0','-1','1e3','0.00001',1]) assert.throws(()=>quoteInput({...q,lines:[{...q.lines[0],quantity}]}));
  for(const amountCents of [0,-1,1.5]) assert.throws(()=>paymentInput({invoiceId:1,amountCents,paidAt:'2026-10-08',method:'CARD'}));
  assert.throws(()=>totals(2147483647,2000));
  const row={status:'ISSUED',dueDate:new Date('2026-01-01'),totalInclTaxCents:100,payments:[]};
  assert.equal(settlement(row,'2026-01-02').paymentStatus,'UNPAID'); assert.equal(settlement(row,'2026-01-01').overdue,false);
  assert.equal(settlement({...row,payments:[{amountCents:40}]},'2026-01-02').paymentStatus,'PARTIAL');
  assert.equal(settlement({...row,payments:[{amountCents:40},{amountCents:60}]},'2026-01-02').paymentStatus,'PAID');
  assert.equal(settlement({...row,status:'CANCELLED'},'2026-01-02').overdue,false);
});
test('migration is additive and preserves existing tables',async()=> {
  const sql=await readFile(new URL('../prisma/migrations/20261008020000_add_finance/migration.sql',import.meta.url),'utf8');
  assert.doesNotMatch(sql,/\b(DROP|TRUNCATE|DELETE FROM|UPDATE\s+")\b/i);
  assert.doesNotMatch(sql,/ALTER TABLE "(Prospect|Action|Client|Contract)"/);
  for(const table of ['Quote','QuoteLine','Invoice','Payment']) assert.ok(sql.includes(`CREATE TABLE "${table}"`));
});
async function exerciseFinance() {
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const request=(p,m='GET',b)=>fetch(base+p,{method:m,headers:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});
  const call=async(p,m,b,expected=200)=> {const r=await request(p,m,b);assert.equal(r.status,expected,await r.clone().text());return expected===204?null:r.json();};
  const beforeData=JSON.stringify(await Promise.all([prisma.prospect.findMany({orderBy:{id:'asc'}}),prisma.action.findMany({orderBy:{id:'asc'}}),prisma.client.findMany({orderBy:{id:'asc'}}),prisma.contract.findMany({orderBy:{id:'asc'}})]));
  let client; const quotes=[],invoices=[];
  try {
    const before=await call('/dashboard/finance'); client=await call('/clients','POST',{firstName:'Finance test',lastName:'Temporary'},201);
    const qb={...q,clientId:client.id,status:'SENT'};
    for (const [rate,tax,ttc] of [[0,0,100000],[2000,20000,120000]]) {
      const single = await call('/quotes','POST',{ ...qb,status:'DRAFT',lines:[{description:'TVA unique',quantity:'1',unitPriceCents:100000,...(rate ? {vatRateBasisPoints:rate} : {})}] },201);
      quotes.push(single.id);assert.equal(single.totalExclTaxCents,100000);assert.equal(single.vatCents,tax);assert.equal(single.totalInclTaxCents,ttc);
      const persisted = await call(`/quotes/${single.id}`);assert.equal(persisted.lines[0].vatRateBasisPoints,rate);await call(`/quotes/${single.id}`,'DELETE',undefined,204);
    }
    let quote=await call('/quotes','POST',qb,201);quotes.push(quote.id);
    assert.equal(quote.vatCents,10000); assert.equal((await call(`/quotes?clientId=${client.id}&status=SENT`)).length,1);
    assert.equal((await call('/dashboard/finance')).proposedExclTaxCents,before.proposedExclTaxCents+150000);
    assert.equal((await request('/quotes','POST',{...qb,reference:quote.reference})).status,409);
    quote=await call(`/quotes/${quote.id}`,'PUT',{...qb,lines:[{description:'Changed',quantity:'1.25',unitPriceCents:10,vatRateBasisPoints:2000}]});assert.equal(quote.totalInclTaxCents,16);
    await call(`/quotes/${quote.id}`,'PUT',{...qb,status:'ACCEPTED'});assert.equal((await request(`/quotes/${quote.id}`,'PUT',qb)).status,409);assert.equal((await request(`/quotes/${quote.id}`,'DELETE')).status,409);
    const disposable=await call('/quotes','POST',{...qb,status:'DRAFT'},201);quotes.push(disposable.id);await call(`/quotes/${disposable.id}`,'DELETE',undefined,204);
    const ib={...inv,clientId:client.id}; let invoice=await call('/invoices','POST',ib,201);invoices.push(invoice.id);
    const pay={invoiceId:invoice.id,amountCents:6000,paidAt:'2026-01-02',method:'BANK_TRANSFER'};
    assert.equal((await request('/payments','POST',pay)).status,409);
    invoice=await call(`/invoices/${invoice.id}`,'PUT',{...ib,status:'ISSUED'});
    const issuedMetrics=await call('/dashboard/finance');assert.equal(issuedMetrics.remainingInclTaxCents,before.remainingInclTaxCents+10000);assert.equal(issuedMetrics.overdueInvoices,before.overdueInvoices+1);assert.equal(issuedMetrics.contractedExclTaxCents,before.contractedExclTaxCents);
    assert.equal(invoice.overdue,true);assert.equal((await request(`/invoices/${invoice.id}`,'PUT',{...ib,status:'ISSUED',totalExclTaxCents:20000})).status,409);
    const concurrent=await Promise.all([request('/payments','POST',pay),request('/payments','POST',pay)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);
    const payment=await concurrent.find(r=>r.status===201).json();
    assert.equal((await call(`/invoices/${invoice.id}`)).paymentStatus,'PARTIAL');
    assert.equal((await request(`/invoices/${invoice.id}`,'PUT',{...ib,status:'CANCELLED'})).status,409);assert.equal((await request(`/invoices/${invoice.id}`,'DELETE')).status,409);
    await call(`/payments/${payment.id}`,'PUT',{...pay,amountCents:5000});
    const second=await call('/payments','POST',{...pay,amountCents:5000},201);
    assert.equal((await request('/payments','POST',{...pay,amountCents:1})).status,409);
    assert.equal((await call(`/invoices/${invoice.id}`)).paymentStatus,'PAID');assert.equal((await call(`/invoices/${invoice.id}`)).overdue,false);
    const metrics=await call('/dashboard/finance');assert.equal(metrics.invoicedExclTaxCents,before.invoicedExclTaxCents+10000);assert.equal(metrics.receivedInclTaxCents,before.receivedInclTaxCents+10000);
    assert.equal(metrics.remainingInclTaxCents,before.remainingInclTaxCents);assert.equal(metrics.overdueInvoices,before.overdueInvoices);assert.equal(metrics.proposedExclTaxCents,before.proposedExclTaxCents);
    await call(`/payments/${second.id}`,'DELETE',undefined,204);await call(`/payments/${payment.id}`,'DELETE',undefined,204);
    await call(`/invoices/${invoice.id}`,'PUT',{...ib,status:'CANCELLED'});assert.equal((await call('/dashboard/finance')).invoicedExclTaxCents,before.invoicedExclTaxCents);
    assert.equal((await request('/payments','POST',pay)).status,409);
    await prisma.$disconnect();assert.equal((await call(`/quotes/${quote.id}`)).lines[1].vatRateBasisPoints,2000);
    const draft=await call('/invoices','POST',ib,201);invoices.push(draft.id);await call(`/invoices/${draft.id}`,'DELETE',undefined,204);
  } finally {
    await prisma.payment.deleteMany({where:{invoiceId:{in:invoices}}});await prisma.invoice.deleteMany({where:{id:{in:invoices}}});await prisma.quote.deleteMany({where:{id:{in:quotes}}});if(client) await prisma.client.delete({where:{id:client.id}});
    const after=JSON.stringify(await Promise.all([prisma.prospect.findMany({orderBy:{id:'asc'}}),prisma.action.findMany({orderBy:{id:'asc'}}),prisma.client.findMany({orderBy:{id:'asc'}}),prisma.contract.findMany({orderBy:{id:'asc'}})]));assert.equal(after,beforeData);
    await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();
  }
}
test('PostgreSQL finance CRUD, locks, concurrent payments, metrics and existing data preservation',{skip:process.env.TEST_DATABASE!=='1'},exerciseFinance);
test('finance HTTP CRUD, immutable documents, payment corrections and metrics with Prisma doubles',async()=> {
  const saved=[], tables={prospect:new Map(),action:new Map(),client:new Map(),contract:new Map(),quote:new Map(),invoice:new Map(),payment:new Map()};let seq=1;
  const patch=(obj,k,fn)=>{saved.push([obj,k,obj[k]]);obj[k]=fn;};
  const fail=code=>{throw new (awaitPrisma.PrismaClientKnownRequestError)(code,{code,clientVersion:'7'});};
  const {Prisma:awaitPrisma}=await import('../dist/generated/prisma/client.js');
  const match=(r,w={})=>Object.entries(w).every(([k,v])=>v && typeof v==='object' ? ('in' in v ? v.in.includes(r[k]) : k==='invoice' ? match(tables.invoice.get(r.invoiceId),v) : true) : r[k]===v);
  function decorate(name,row) {
    if(!row)return null; const r={...row};
    if(name==='client')r._count={contracts:[...tables.contract.values()].filter(c=>c.clientId===r.id).length};
    if(name==='quote'||name==='invoice')r.client=tables.client.get(r.clientId);
    if(name==='invoice')r.payments=[...tables.payment.values()].filter(p=>p.invoiceId===r.id);
    return r;
  }
  for(const [name,table] of Object.entries(tables)) {
    const d=prisma[name];
    patch(d,'findUnique',async({where})=>decorate(name,table.get(where.id)));
    patch(d,'findUniqueOrThrow',async({where})=>{if(!table.has(where.id))fail('P2025');return decorate(name,table.get(where.id));});
    patch(d,'findMany',async({where}={})=>[...table.values()].filter(r=>match(r,where)).map(r=>decorate(name,r)));
    patch(d,'create',async({data})=>{
      if(data.reference && [...table.values()].some(r=>r.reference===data.reference))fail('P2002');
      const row={...data,id:seq++}; if(name==='quote')row.lines=data.lines.create;
      table.set(row.id,row);return decorate(name,row);
    });
    patch(d,'update',async({where,data})=>{if(!table.has(where.id))fail('P2025');const row={...table.get(where.id),...data};if(name==='quote')row.lines=data.lines.create;table.set(row.id,row);return decorate(name,row);});
    patch(d,'delete',async({where})=>{if(!table.has(where.id))fail('P2025');table.delete(where.id);});
    patch(d,'deleteMany',async({where})=>{for(const [id,r]of table)if(match(r,where))table.delete(id);});
    patch(d,'aggregate',async({where,_sum})=>({_sum:Object.fromEntries(Object.keys(_sum).map(k=>[k,[...table.values()].filter(r=>match(r,where)).reduce((s,r)=>s+r[k],0)]))}));
  }
  // Serial callback execution emulates locks for API behavior; real concurrency is tested separately on PostgreSQL.
  let queue=Promise.resolve();
  patch(prisma,'$transaction',fn=>{const result=queue.then(async()=>{const snapshot=Object.fromEntries(Object.entries(tables).map(([name,table])=>[name,new Map(table)]));try{return await fn(prisma);}catch(e){for(const k of Object.keys(tables)){tables[k].clear();for(const [id,r]of snapshot[k])tables[k].set(id,r);}throw e;}});queue=result.catch(()=>{});return result;});
  patch(prisma,'$queryRaw',async(strings,id)=>{const name=strings.join('').includes('"Quote"')?'quote':'invoice';return tables[name].has(id)?[{id}]:[];});
  patch(prisma,'$disconnect',async()=>{});
  try{await exerciseFinance();}finally{for(const [obj,k,fn]of saved)obj[k]=fn;}
});
