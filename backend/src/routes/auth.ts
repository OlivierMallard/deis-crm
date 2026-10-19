import { assertDevPurge } from '../lib/dev-purge.js';
import { Router, type RequestHandler } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { ValidationError } from '../validation/prospects.js';
import { parseId } from '../validation/commerce.js';

export const authRouter = Router(), adminRouter = Router();
const publicUser = { id:true,email:true,name:true,role:true,isActive:true,createdAt:true,lastLoginAt:true } as const;
const digest = (s:string) => createHash('sha256').update(s).digest('hex');
const cookieName = process.env.NODE_ENV === 'production' ? '__Host-crm-session' : 'crm-session';
const cookieOptions = { httpOnly:true, sameSite:'strict' as const, secure:process.env.NODE_ENV==='production', path:'/' };
export const hashPassword = (password:string) => argon2.hash(password,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
export function passwordInput(value:unknown) { if(typeof value!=='string'||value.length<12||value.length>128) throw new ValidationError('Mot de passe : 12 à 128 caractères requis.');return value; }
export async function audit(userId:number|null,action:string,target?:string,details?:object) { await prisma.auditLog.create({data:{userId,action,target,details}}); }
export const session:RequestHandler = async(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  const raw=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(raw && /^[a-f0-9]{64}$/.test(raw)) {
    const found=await prisma.session.findUnique({where:{tokenHash:digest(raw)},include:{user:{select:publicUser}}});
    if(found && found.expiresAt>new Date() && found.user.isActive) res.locals.auth=found;
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin=req.get('origin');
    if(origin && origin!==(process.env.APP_ORIGIN??'http://localhost:5173')) {res.status(403).json({message:'Origine refusée.'});return;}
    if(req.get('sec-fetch-site')==='cross-site') {res.status(403).json({message:'Origine refusée.'});return;}
    if(res.locals.auth && req.get('x-csrf-token')!==res.locals.auth.csrf) {res.status(403).json({message:'Protection CSRF : rechargez la page.'});return;}
  }
  next();
};
export const authenticated:RequestHandler=(_req,res,next)=>{if(!res.locals.auth){res.status(401).json({message:'Session absente ou expirée. Reconnectez-vous.'});return;}next();};
export const admin:RequestHandler=(_req,res,next)=>{if(res.locals.auth?.user.role!=='ADMIN'){res.status(403).json({message:'Accès réservé aux administrateurs.'});return;}next();};
authRouter.post('/login',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'Trop de tentatives. Réessayez dans 15 minutes.'}}),async(req,res)=>{
  const {email,password}=req.body??{};
  if(typeof email!=='string'||typeof password!=='string'||password.length>128||email.length>254){res.status(401).json({message:'Identifiants invalides.'});return;}
  const user=await prisma.user.findUnique({where:{email:email.trim().toLowerCase()}});
  const valid=user ? await argon2.verify(user.passwordHash,password) : (await hashPassword(password),false);
  if(!user||!valid||!user.isActive){await audit(null,'LOGIN_FAILED');res.status(401).json({message:'Identifiants invalides.'});return;}
  const raw=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  const expiresAt=new Date(Date.now()+8*3600000);
  const current=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR UPDATE`;
    const fresh=await tx.user.findUniqueOrThrow({where:{id:user.id}});
    if(!fresh.isActive || fresh.passwordHash!==user.passwordHash)return null;
    await tx.session.create({data:{tokenHash:digest(raw),userId:user.id,csrf,expiresAt}});
    await tx.user.update({where:{id:user.id},data:{lastLoginAt:new Date()}});
    await tx.auditLog.create({data:{userId:user.id,action:'LOGIN'}});
    return fresh;
  });
  if(!current){res.status(401).json({message:'Identifiants invalides.'});return;}
  res.cookie(cookieName,raw,{...cookieOptions,maxAge:8*3600000}).json({user:Object.fromEntries(Object.keys(publicUser).map(k=>[k,current[k as keyof typeof current]])),csrf});
});
authRouter.get('/session',authenticated,(_req,res)=>res.json({user:res.locals.auth.user,csrf:res.locals.auth.csrf}));
authRouter.post('/logout',authenticated,async(_req,res)=>{await prisma.$transaction(async tx=>{await tx.session.delete({where:{tokenHash:res.locals.auth.tokenHash}});await tx.auditLog.create({data:{userId:res.locals.auth.user.id,action:'LOGOUT'}});});res.clearCookie(cookieName,cookieOptions).status(204).end();});
adminRouter.use(authenticated,admin);
adminRouter.get('/users',async(_req,res)=>res.json(await prisma.user.findMany({select:publicUser,orderBy:{id:'asc'}})));
adminRouter.get('/audit',async(req,res)=>{const page=Number(req.query.page??1);if(!Number.isSafeInteger(page)||page<1)throw new ValidationError('Page invalide.');res.json(await prisma.auditLog.findMany({orderBy:{id:'desc'},take:100,skip:(page-1)*100}));});
adminRouter.post('/users',async(req,res)=>{
  const {email,name,role,password}=req.body??{};
  if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||typeof name!=='string'||!name.trim()||name.length>150||!['ADMIN','USER'].includes(role))throw new ValidationError('Utilisateur invalide.');
  const passwordHash=await hashPassword(passwordInput(password));
  const user=await prisma.$transaction(async tx=>{const row=await tx.user.create({data:{email:email.trim().toLowerCase(),name:name.trim(),role,passwordHash},select:publicUser});await tx.auditLog.create({data:{userId:res.locals.auth.user.id,action:'USER_CREATED',target:String(row.id)}});return row;});res.status(201).json(user);
});
adminRouter.patch('/users/:id',async(req,res)=>{
  const id=parseId(req.params.id),body=req.body??{};
  if(Object.keys(body).some(k=>!['role','isActive','password'].includes(k))|| (body.role!==undefined&&!['ADMIN','USER'].includes(body.role))||(body.isActive!==undefined&&typeof body.isActive!=='boolean'))throw new ValidationError('Modification invalide.');
  const passwordHash=body.password===undefined?undefined:await hashPassword(passwordInput(body.password));
  const result=await prisma.$transaction(async tx=>{
    // One database lock serializes all administrator membership changes, including concurrent requests.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(101910)::text`;
    const old=await tx.user.findUniqueOrThrow({where:{id}});
    if(old.role==='ADMIN'&&old.isActive&&(body.role==='USER'||body.isActive===false)&&await tx.user.count({where:{role:'ADMIN',isActive:true}})<=1)return null;
    const row=await tx.user.update({where:{id},data:{role:body.role,isActive:body.isActive,passwordHash},select:publicUser});
    await tx.session.deleteMany({where:{userId:id}});
    await tx.auditLog.create({data:{userId:res.locals.auth.user.id,action:passwordHash?'USER_ACCESS_RESET':old.role!==row.role?'ROLE_CHANGED':!row.isActive?'USER_DEACTIVATED':'USER_UPDATED',target:String(id),details:{previousRole:old.role,role:row.role,previousIsActive:old.isActive,isActive:row.isActive,passwordReset:!!passwordHash}}});return row;
  });
  if(!result){res.status(409).json({message:'Le dernier administrateur actif doit être conservé.'});return;}res.json(result);
});

adminRouter.post('/purge-fiction',async(req,res)=>{
  assertDevPurge();
  const id=parseId(req.body?.invoiceId);
  if(req.body?.confirmation!==`PURGE FICTION ${id}`)throw new ValidationError('Confirmation explicite requise.');
  // Only a deliberately marked fictional invoice may be removed; never infer fictional status.
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${id} FOR UPDATE`;
    const row=await tx.invoice.findUniqueOrThrow({where:{id},include:{payments:true}});
    if(!row.reference.startsWith('FICTION-')||!row.title.startsWith('[FICTION]'))throw new ValidationError('Facture fictive explicitement marquée requise.');
    await tx.payment.deleteMany({where:{invoiceId:id}});
    await tx.invoice.delete({where:{id}});
    await tx.auditLog.create({data:{userId:res.locals.auth.user.id,action:'DEV_PURGE_FICTION',target:String(id),details:{payments:row.payments.length}}});
  });res.status(204).end();
});
