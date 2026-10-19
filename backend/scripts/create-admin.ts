import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, passwordInput } from '../src/routes/auth.js';
async function secret(prompt:string):Promise<string> {
  if(!stdin.isTTY)throw new Error('Un terminal interactif est requis.');
  stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
  return new Promise((resolve,reject)=>{let value='';const read=(chunk:Buffer)=>{for(const c of chunk.toString()){if(c==='\u0003'){cleanup();reject(new Error('Annulé'));return;}if(c==='\r'||c==='\n'){cleanup();resolve(value);return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c;}};const cleanup=()=>{stdin.off('data',read);stdin.setRawMode(false);stdin.pause();stdout.write('\n');};stdin.on('data',read);});
}
try {
  const rl=createInterface({input:stdin,output:stdout});
  const email=(await rl.question('Email : ')).trim().toLowerCase(),name=(await rl.question('Nom : ')).trim();rl.close();
  if(!/^\S+@\S+\.\S+$/.test(email)||!name)throw new Error('Email ou nom invalide.');
  const password=passwordInput(await secret('Mot de passe (masqué) : '));
  if(password!==await secret('Confirmation : '))throw new Error('Confirmation différente.');
  const passwordHash=await hashPassword(password);
  await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(101910)::text`;if(await tx.user.count({where:{role:'ADMIN',isActive:true}}))throw new Error('Un administrateur actif existe déjà. Utilisez Administration.');const user=await tx.user.create({data:{email,name,passwordHash,role:'ADMIN'}});await tx.auditLog.create({data:{userId:user.id,action:'ADMIN_BOOTSTRAP'}});});
  console.log('Administrateur créé.');
} catch(error) {console.error(error instanceof Error?error.message:'Erreur');process.exitCode=1;} finally {await prisma.$disconnect();}
