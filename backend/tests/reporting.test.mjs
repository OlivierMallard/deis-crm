import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { parseList, localBounds, kinds } from '../dist/validation/lists.js';
import { reportPeriod, conversionRate } from '../dist/routes/reports.js';
import { csv, csvCell } from '../dist/routes/discovery.js';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';

test('list validation, combined filters, stable sorts and bounded pagination',()=>{
  const p=parseList('prospects',{q:'ALICE',status:'QUALIFIED',createdFrom:'2026-03-29',createdTo:'2026-03-29',timeZone:'Europe/Paris',sort:'name',page:'2',pageSize:'10'});
  assert.equal(p.page,2);assert.equal(p.pageSize,10);assert.deepEqual(p.orderBy,[{lastName:'asc'},{id:'desc'}]);
  assert.equal(p.where.status,'QUALIFIED');assert.equal(p.where.OR[0].firstName.mode,'insensitive');
  assert.equal(p.where.createdAt.gte.toISOString(),'2026-03-28T23:00:00.000Z');assert.equal(p.where.createdAt.lt.toISOString(),'2026-03-29T22:00:00.000Z');
  for(const query of [{page:'0'},{page:'1.5'},{pageSize:'101'},{q:'x'.repeat(201)},{q:['x']},{createdFrom:'2026-02-30'},{createdFrom:'2026-10-10',createdTo:'2026-10-01'},{status:'BAD'},{sort:'BAD'},{direction:'BAD'},{extra:'x'},{timeZone:'BAD'}])assert.throws(()=>parseList('prospects',query));
  for(const query of [{amountMin:'-1'},{amountMin:'1.1'},{amountMin:'100',amountMax:'99'},{clientId:'0'}])assert.throws(()=>parseList('contracts',query));
  for(const query of [{paymentStatus:'BAD'},{overdue:'yes'},{dueFrom:'BAD'}])assert.throws(()=>parseList('invoices',query));
  assert.deepEqual(parseList('clients',{sort:'contracts'}).orderBy,[{contracts:{_count:'desc'}},{id:'desc'}]);
  assert.equal(parseList('contracts',{clientId:'1',status:'SIGNED',amountMin:'100',amountMax:'200'}).where.amountCents.lte,200);
  for(const kind of kinds){assert.equal(parseList(kind,{}).pageSize,25);assert.ok(parseList(kind,{}).orderBy.at(-1).id)}
});
test('calendar periods across DST and extreme IANA offsets',()=>{
  for(const [date,hours] of [['2026-03-29',23],['2026-10-25',25]]){const p=reportPeriod({from:date,to:date,timeZone:'Europe/Paris'});assert.equal((p.end-p.start)/3600000,hours)}
  assert.equal(localBounds('2026-10-08','Pacific/Kiritimati').start.toISOString(),'2026-10-07T10:00:00.000Z');
  assert.equal(localBounds('2026-10-08','America/Los_Angeles').start.toISOString(),'2026-10-08T07:00:00.000Z');
  for(const q of [{from:'2026-02-30'},{from:'2027-01-01',to:'2026-01-01'},{from:'2020-01-01',to:'2026-01-01'},{timeZone:'bad'},{extra:'x'}])assert.throws(()=>reportPeriod(q));
  assert.equal(conversionRate(0,0),0);assert.equal(conversionRate(1,4),25);
});
test('CSV BOM, delimiters, quotes, newlines and formula injection',()=>{
  const output=csv([['Prénom','Société'],['Élodie','A;"B\nC']]);assert.ok(output.startsWith('\uFEFF'));assert.ok(output.includes('"A;""B\nC"'));
  for(const v of ['=1+1','+CMD','-1','@SUM(A1)',' \t=1','\ttext','\rtext','\ntext'])assert.ok(csvCell(v).startsWith('"\''));
  assert.equal(csvCell('Alice'),'"Alice"');assert.equal(csvCell(null),'""');
});
test('HTTP search validation and no disclosure in projected Prisma queries',async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
  const saved=[];const models=['prospect','client','contract','quote','invoice'];
  try{
    for(const name of models){saved.push([prisma[name],prisma[name].findMany]);prisma[name].findMany=async args=>{assert.equal(args.take,8);assert.equal(args.where.OR[0][name==='prospect'||name==='client'?'firstName':'reference'].mode,'insensitive');assert.equal(args.select.notes,undefined);assert.equal(args.select.payments,undefined);return [{id:1,...(name==='prospect'||name==='client'?{firstName:'Alice',lastName:'Test'}:{reference:'REF',title:'Test'})}]}}
    const r=await fetch(base+'/search?q=ALICE');assert.equal(r.status,200);const data=await r.json();assert.deepEqual(Object.keys(data).sort(),['clients','contracts','invoices','prospects','quotes']);assert.equal(data.prospects[0].notes,undefined);
    assert.equal((await fetch(base+'/search?q='+ 'x'.repeat(101))).status,400);assert.equal((await fetch(base+'/search?q=x&q=y')).status,400);assert.equal((await fetch(base+'/prospects?pageSize=101')).status,400);
    assert.ok(Object.values(await (await fetch(base+'/search?q=')).json()).every(rows=>rows.length===0));
  }finally{for(const [d,fn] of saved)d.findMany=fn;await new Promise(r=>server.close(r));await prisma.$disconnect()}
});

test('CSV volume guard refuses oversized exports before loading rows',async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const transaction=prisma.$transaction,count=prisma.prospect.count,findMany=prisma.prospect.findMany;
  try {
    prisma.$transaction=async fn=>fn(prisma);prisma.prospect.count=async()=>10001;prisma.prospect.findMany=async()=>{throw new Error('Oversized export must not load rows')};
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/prospects/export`);assert.equal(r.status,400);assert.match((await r.json()).message,/10 000/);
  }finally{prisma.$transaction=transaction;prisma.prospect.count=count;prisma.prospect.findMany=findMany;await new Promise(r=>server.close(r));await prisma.$disconnect()}
});

test('PostgreSQL discovery, filters, pagination, reporting and complete filtered exports',{skip:process.env.TEST_DATABASE!=='1'},async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
  const get=async path=>{const r=await fetch(base+path);assert.equal(r.status,200,await r.clone().text());return r.json()};
  const tag='M9-'+randomUUID(), ids={prospect:[],client:[],contract:[],quote:[],invoice:[],payment:[],action:[]};
  const names=['prospect','action','client','contract','quote','quoteLine','invoice','payment'];
  const snapshot=async()=>createHash('sha256').update(JSON.stringify(await Promise.all(names.map(name=>prisma[name].findMany({orderBy:{id:'asc'}}))))).digest('hex');
  const before=await snapshot();
  const period='from=2026-03-01&to=2026-04-30&timeZone=Europe%2FParis';
  try{
    const baseline=await get('/reports/overview?'+period),monthlyBefore=await get('/reports/monthly?'+period);
    for(let i=0;i<3;i++){const p=await prisma.prospect.create({data:{firstName:tag,lastName:'Same',email:`m9-${i}@example.com`,phone:'0123456789',status:i===0?'CONTACTED':i===1?'QUALIFIED':'WON',createdAt:new Date('2026-03-31T22:30:00Z'),notes:'Confidentiel'}});ids.prospect.push(p.id)}
    const c=await prisma.client.create({data:{firstName:tag,lastName:'Client',sourceProspectId:ids.prospect[2],createdAt:new Date('2026-03-31T22:30:00Z')}});ids.client.push(c.id);
    const contract=await prisma.contract.create({data:{clientId:c.id,title:tag,reference:tag,amountCents:12345,status:'SIGNED',signedAt:new Date('2026-03-31T22:30:00Z'),createdAt:new Date('2026-01-01')}});ids.contract.push(contract.id);
    const undated=await prisma.contract.create({data:{clientId:c.id,title:tag,reference:tag+'-undated',amountCents:999999,status:'SIGNED',signedAt:null}});ids.contract.push(undated.id);
    const quote=await prisma.quote.create({data:{clientId:c.id,title:tag,reference:tag,status:'SENT',issueDate:new Date('2026-03-31'),totalExclTaxCents:20000,vatCents:0,totalInclTaxCents:20000}});ids.quote.push(quote.id);
    const invoice=await prisma.invoice.create({data:{clientId:c.id,title:tag,reference:tag,status:'ISSUED',issueDate:new Date('2026-03-31'),dueDate:new Date('2026-04-01'),totalExclTaxCents:10000,vatCents:2000,vatRateBasisPoints:2000,totalInclTaxCents:12000}});ids.invoice.push(invoice.id);
    const payment=await prisma.payment.create({data:{invoiceId:invoice.id,amountCents:6000,paidAt:new Date('2026-04-01'),method:'CARD'}});ids.payment.push(payment.id);
    const paymentPage=await get(`/payments?invoiceId=${invoice.id}&pageSize=1`);assert.equal(paymentPage.total,1);assert.equal(paymentPage.items[0].id,payment.id);
    const action=await prisma.action.create({data:{prospectId:ids.prospect[0],type:'CALL',title:tag,dueAt:new Date('2026-03-30'),completedAt:new Date('2026-04-01')}});ids.action.push(action.id);
    const search=await get('/search?q='+tag.toLowerCase());assert.equal(search.prospects.length,3);assert.equal(search.clients.length,1);assert.equal(search.contracts.length,2);assert.equal(search.quotes.length,1);assert.equal(search.invoices.length,1);assert.equal(search.prospects[0].notes,undefined);
    for(const q of ['q='+tag.toLowerCase(),'q=0123456789&status=CONTACTED','q='+tag+'&status=QUALIFIED&createdFrom=2026-04-01&createdTo=2026-04-01&timeZone=Europe%2FParis']){assert.ok((await get('/prospects?'+q)).total>=1)}
    const page1=await get('/prospects?q='+tag+'&pageSize=1&sort=name'),page2=await get('/prospects?q='+tag+'&pageSize=1&sort=name&page=2');assert.equal(page1.total,3);assert.equal(page1.totalPages,3);assert.equal(page1.items[0].id,ids.prospect[2]);assert.equal(page2.items[0].id,ids.prospect[1]);
    assert.deepEqual((await get('/prospects?q='+tag+'&pageSize=1&sort=name')).items,page1.items);assert.equal((await get('/prospects?q='+tag+'&page=99')).items.length,0);
    assert.equal((await get('/clients?q='+tag+'&sort=contracts')).items[0]._count.contracts,2);
    assert.equal((await get(`/contracts?clientId=${c.id}&status=SIGNED&amountMin=12345&amountMax=12345`)).total,1);
    assert.equal((await get(`/quotes?clientId=${c.id}&dateFrom=2026-03-31&dateTo=2026-03-31&amountMin=20000`)).total,1);
    assert.equal((await get(`/actions?q=${tag}&type=CALL&completed=true&prospectId=${ids.prospect[0]}`)).total,1);
    assert.equal((await get(`/invoices?clientId=${c.id}&paymentStatus=PARTIAL&overdue=true`)).total,1);
    assert.equal((await get(`/invoices?clientId=${c.id}&paymentStatus=PAID`)).total,0);
    const overview=await get('/reports/overview?'+period);for(const [key,delta] of Object.entries({prospectsCreated:3,prospectsCurrentlyContacted:1,prospectsCurrentlyQualified:1,cohortConverted:1,clientsCreated:1,contractsSigned:1,signedExclTaxCents:12345,sentQuotesExclTaxCents:20000,invoicedExclTaxCents:10000,receivedInclTaxCents:6000,actionsCompleted:1}))assert.equal(overview[key]-baseline[key],delta,key);
    assert.equal(overview.conversionRate,overview.cohortConverted/overview.prospectsCreated*100);
    const months=await get('/reports/monthly?'+period);assert.deepEqual(months.map(m=>m.month),['2026-03','2026-04']);assert.equal(months[1].prospectsCreated-monthlyBefore[1].prospectsCreated,3);assert.equal(months[1].signedExclTaxCents-monthlyBefore[1].signedExclTaxCents,12345);assert.equal(months[0].invoicedExclTaxCents-monthlyBefore[0].invoicedExclTaxCents,10000);assert.equal(months[1].receivedInclTaxCents-monthlyBefore[1].receivedInclTaxCents,6000);
    const pipeline=await get('/reports/pipeline');assert.ok(pipeline.contracts.some(r=>r.status==='SIGNED'&&r._count>=2));
    for(const kind of kinds){const r=await fetch(base+`/${kind}/export?q=${tag}&pageSize=1`);assert.equal(r.status,200);const content=Buffer.from(await r.arrayBuffer());assert.equal(content.subarray(0,3).toString('hex'),'efbbbf');assert.ok(content.toString().includes(tag));if(kind==='prospects')assert.equal(content.toString().split('\r\n').length,5)}
    const empty=await get('/reports/monthly?from=1900-01-01&to=1900-02-28');assert.equal(empty.length,2);assert.ok(empty.every(m=>m.prospectsCreated===0));
  }finally{
    for(const name of ['payment','invoice','quote','contract','client','action','prospect'])await prisma[name].deleteMany({where:{id:{in:ids[name]}}});
    assert.equal(await snapshot(),before,'All pre-existing rows preserved');await new Promise(r=>server.close(r));await prisma.$disconnect();
  }
});

test('persistent monthly goal, atomic updates, validation, actual invoiced progress',async()=>{
  // A separate process isolates the goal file from the user's server configuration.
  const {spawn}=await import('node:child_process');
  const directory=await mkdtemp(join(tmpdir(),'crm-m9-goal-'));
  const child=spawn(process.execPath,['--input-type=module','-e',`
    const {app}=await import('./dist/app.js');const {prisma}=await import('./dist/lib/prisma.js');
    prisma.invoice.aggregate=async()=>({_sum:{totalExclTaxCents:125000}});
    const server=app.listen(0,'127.0.0.1',()=>console.log(server.address().port));
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `],{cwd:process.cwd(),env:{...process.env,REPORTING_GOAL_FILE:join(directory,'goal.json')},stdio:['ignore','pipe','pipe']});
  try{
    const port=await new Promise((resolve,reject)=>{child.stdout.once('data',b=>resolve(Number(b.toString().trim())));child.once('error',reject);child.once('exit',code=>reject(new Error('Goal process exited '+code)))});
    const base=`http://127.0.0.1:${port}/api/reports/goal`;
    let goal=await(await fetch(base)).json();assert.equal(goal.monthlyExclTaxCents,500000);assert.equal(goal.achievementPercent,25);assert.equal(goal.remainingExclTaxCents,375000);
    for(const body of [{monthlyExclTaxCents:-1},{monthlyExclTaxCents:1.5},{monthlyExclTaxCents:'100'},{monthlyExclTaxCents:100,extra:true}])assert.equal((await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,400);
    for(const value of [250000,0]){const r=await fetch(base,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({monthlyExclTaxCents:value})});assert.equal(r.status,200);goal=await(await fetch(base)).json();assert.equal(goal.monthlyExclTaxCents,value);assert.equal(goal.achievementPercent,value?50:null)}
    const {readFile}=await import('node:fs/promises');assert.equal(JSON.parse(await readFile(join(directory,'goal.json'),'utf8')).monthlyExclTaxCents,0);
  }finally{const stopped=once(child,'exit');child.kill();await stopped;await rm(directory,{recursive:true,force:true})}
});
