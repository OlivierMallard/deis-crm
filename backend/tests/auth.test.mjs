import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import argon2 from 'argon2';
import ExcelJS from 'exceljs';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';
import { hashPassword, passwordInput } from '../dist/routes/auth.js';
import { assertDevPurge } from '../dist/lib/dev-purge.js';
import { csv } from '../dist/routes/discovery.js';

test('Argon2id, password bounds and production purge guard',async()=>{
 const hash=await hashPassword('test-password-123');assert.match(hash,/^\$argon2id\$/);assert.ok(await argon2.verify(hash,'test-password-123'));assert.equal(await argon2.verify(hash,'invalid'),false);
 for(const value of ['',null,'x'.repeat(129)])assert.throws(()=>passwordInput(value));
 const old={...process.env};try{for(const env of ['production','test',undefined]){process.env.NODE_ENV=env;process.env.ALLOW_DEV_PURGE='true';assert.throws(assertDevPurge)}process.env.NODE_ENV='development';process.env.ALLOW_DEV_PURGE='false';assert.throws(assertDevPurge);process.env.ALLOW_DEV_PURGE='true';assert.doesNotThrow(assertDevPurge)}finally{process.env.NODE_ENV=old.NODE_ENV;process.env.ALLOW_DEV_PURGE=old.ALLOW_DEV_PURGE}
});

test('HTTP auth, role enforcement, CSRF, session revocation and typed exports',async()=>{
 const saved=[],patch=(obj,key,value)=>{const original=obj[key];saved.push(()=>obj[key]=original);obj[key]=value;};
 const hash=await hashPassword('test-password-123');
 let user={id:123,email:'test@example.invalid',name:'Test',role:'ADMIN',isActive:true,passwordHash:hash},session=null;
 patch(prisma.user,'findMany',async()=>[{id:user.id,email:user.email,role:user.role}]);patch(prisma.user,'findUnique',async()=>user);patch(prisma.user,'findUniqueOrThrow',async()=>user);patch(prisma.user,'count',async()=>1);patch(prisma.user,'update',async({data})=>{user={...user,...data};return user});
 patch(prisma.session,'findUnique',async()=>session?{...session,user}:null);patch(prisma.session,'create',async({data})=>session=data);patch(prisma.session,'delete',async()=>{session=null});patch(prisma.session,'deleteMany',async()=>{session=null});
 const logs=[];patch(prisma.auditLog,'create',async({data})=>{logs.push(data);return data});patch(prisma,'$queryRaw',async()=>[]);patch(prisma,'$transaction',async fn=>fn(prisma));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
 let cookie='',csrf='';const req=(path,method='GET',body,extra={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie,'x-csrf-token':csrf,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await req('/prospects')).status,401);assert.equal((await req('/admin/users')).status,401);
  assert.equal((await req('/auth/login','POST',{email:user.email,password:'invalid'})).status,401);
  assert.equal((await req('/auth/login','POST',{email:user.email,password:'test-password-123'},{origin:'https://evil.invalid'})).status,403);
  const login=await req('/auth/login','POST',{email:user.email,password:'test-password-123'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/i);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/i);
  cookie=login.headers.get('set-cookie').split(';')[0];const payload=await login.json();csrf=payload.csrf;assert.equal(payload.user.passwordHash,undefined);assert.equal((await req('/auth/session')).status,200);
  assert.equal((await req('/admin/users')).status,200);
  session.expiresAt=new Date(0);assert.equal((await req('/auth/session')).status,401);session.expiresAt=new Date(Date.now()+3600000);
  user.isActive=false;assert.equal((await req('/auth/session')).status,401);user.isActive=true;
  assert.equal((await req('/admin/users/123','PATCH',{role:'USER'},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await req('/admin/users/123','PATCH',{role:'USER'})).status,409);
  assert.equal((await req('/admin/users/123','PATCH',{isActive:false})).status,409);
  const originalEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';assert.equal((await req('/admin/purge-fiction','POST',{invoiceId:1,confirmation:'PURGE FICTION 1'})).status,400);if(originalEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=originalEnv;
  user.role='USER';assert.equal((await req('/admin/users')).status,403);assert.equal((await req('/prospects/1','DELETE')).status,403);assert.equal((await req('/prospects/1/archive','POST',{archived:true})).status,403);
  const date=new Date('2026-10-19T00:00:00Z');let args;
  patch(prisma.invoice,'count',async()=>2);patch(prisma.invoice,'findMany',async a=>{args=a;return [1,2].map(id=>({id,reference:id===1?'=1+1':'FAC-2',title:'Test',clientId:1,client:{firstName:'Alice',lastName:'Martin'},status:'ISSUED',issueDate:date,dueDate:date,totalExclTaxCents:10000,vatCents:2000,totalInclTaxCents:12000,payments:[{amountCents:3000}]}))});
  const output=await req('/invoices/export?format=xlsx&page=2&pageSize=1&clientId=1');assert.equal(output.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(await output.arrayBuffer()));const sheet=book.worksheets[0];assert.equal(sheet.rowCount,3);assert.equal(args.skip,0);assert.equal(args.where.clientId,1);const header=sheet.getRow(1).values;const column=s=>header.indexOf(s);assert.equal(sheet.getCell(2,column('Montant HT (€)')).value,100);assert.equal(sheet.getCell(2,column('Montant réglé (€)')).value,30);assert.equal(sheet.getCell(2,column('Solde TTC (€)')).value,90);assert.ok(sheet.getCell(2,column('Émission')).value instanceof Date);assert.equal(sheet.getCell(2,1).value,'=1+1');assert.equal(sheet.getCell(2,1).type,ExcelJS.ValueType.String);
  const csvResponse=await req('/invoices/export?clientId=1');const bytes=Buffer.from(await csvResponse.arrayBuffer());assert.equal(bytes.subarray(0,3).toString('hex'),'efbbbf');assert.match(bytes.toString(),/"'=1\+1"/);assert.match(csv([['a;b']]),/"a;b"/);
  assert.ok(logs.some(l=>l.action==='EXPORT'));assert.equal((await req('/auth/logout','POST')).status,204);assert.equal((await req('/auth/session')).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));saved.reverse().forEach(fn=>fn());await prisma.$disconnect()}
});

test('PostgreSQL sessions, administration and password reset revoke access',{skip:process.env.TEST_DATABASE!=='1'},async()=>{
 const {randomUUID}=await import('node:crypto');const tag=randomUUID(),password='Temporary-'+randomUUID();let administrator,standard;
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api`;
 const login=async email=>{const r=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],...(await r.json())}};
 const call=(actor,path,method='GET',body)=>fetch(base+path,{method,headers:{cookie:actor.cookie,'x-csrf-token':actor.csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  administrator=await prisma.user.create({data:{email:`admin-${tag}@example.invalid`,name:'Mission 10 test',role:'ADMIN',passwordHash:await hashPassword(password)}});
  const admin=await login(administrator.email);const created=await call(admin,'/admin/users','POST',{email:`user-${tag}@example.invalid`,name:'Temporary user',role:'USER',password});assert.equal(created.status,201);standard=await created.json();assert.equal(standard.passwordHash,undefined);
  const user=await login(standard.email);assert.equal((await (await call(user,'/auth/session')).json()).user.passwordHash,undefined);assert.equal((await call(user,'/admin/users')).status,403);assert.equal((await call(user,'/admin/audit')).status,403);assert.equal((await call(admin,'/admin/audit')).status,200);
  const storedSession=await prisma.session.findFirstOrThrow({where:{userId:standard.id}});assert.notEqual(storedSession.tokenHash,user.cookie.split('=')[1]);
  const reset=await call(admin,`/admin/users/${standard.id}`,'PATCH',{password:'Changed-'+randomUUID()});assert.equal(reset.status,200);assert.equal((await call(user,'/auth/session')).status,401);
  const stored=await prisma.user.findUniqueOrThrow({where:{id:standard.id}});assert.ok(stored.lastLoginAt);assert.notEqual(stored.passwordHash,password);
  assert.ok(await prisma.auditLog.count({where:{userId:administrator.id,action:'USER_ACCESS_RESET',target:String(standard.id)}}));
 }finally{
  const ids=[administrator?.id,standard?.id].filter(Boolean);if(ids.length){await prisma.session.deleteMany({where:{userId:{in:ids}}});await prisma.auditLog.deleteMany({where:{userId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}})}
  await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();
 }
});
