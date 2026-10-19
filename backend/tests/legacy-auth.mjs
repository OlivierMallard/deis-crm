// Explicit authenticated fixture for legacy business tests. No production bypass.
import { prisma } from '../dist/lib/prisma.js';
prisma.session.findUnique=async()=>({tokenHash:'fixture',csrf:'fixture-csrf',expiresAt:new Date(Date.now()+3600000),user:{id:1,name:'Test administrator',email:'test@example.invalid',role:'ADMIN',isActive:true}});
prisma.auditLog.create=async()=>({id:1});
const realTransaction=prisma.$transaction.bind(prisma);
prisma.$transaction=(operation,...options)=>typeof operation==='function'
  ? realTransaction(tx=>operation(new Proxy(tx,{get:(target,key)=>key==='auditLog'?prisma.auditLog:Reflect.get(target,key)})),...options)
  : realTransaction(operation,...options);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(url,options={})=>{const headers=new Headers(options.headers);headers.set('cookie','crm-session='+'a'.repeat(64));headers.set('x-csrf-token','fixture-csrf');return nativeFetch(url,{...options,headers});};
