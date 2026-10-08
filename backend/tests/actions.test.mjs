import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';
import { dayBounds, parseActionFilters, parseActionInput } from '../dist/validation/actions.js';
const input = { prospectId: 1, type: 'CALL', title: 'Follow-up', description: null, dueAt: '2026-10-08T10:00:00.000Z' };
test('validation actions et filtres', () => {
  assert.equal(parseActionInput(input).title, 'Follow-up');
  for (const body of [null, [], {}, { ...input, prospectId: '1' }, { ...input, prospectId: 0 }, { ...input, type: 'NO' }, { ...input, title: ' ' }, { ...input, description: 3 }, { ...input, dueAt: '2026-02-30T10:00:00Z' }, { ...input, dueAt: '2026-10-08T10:00' }, { ...input, completedAt: null }]) assert.throws(() => parseActionInput(body));
  for (const query of [{ completed: 'yes' }, { period: 'bad' }, { timeZone: 'bad' }, { prospectId: '0' }, { period: ['today'] }, { completed: ['false'] }]) assert.throws(() => parseActionFilters(query));
  const now = new Date('2026-10-08T10:00:00Z');
  assert.deepEqual(parseActionFilters({ completed: 'false', prospectId: '1', period: 'today', timeZone: 'Europe/Paris' }, now), { completedAt: null, prospectId: 1, dueAt: { gte: new Date('2026-10-07T22:00:00Z'), lt: new Date('2026-10-08T22:00:00Z') } });
  assert.deepEqual(parseActionFilters({ period: 'overdue', timeZone: 'Europe/Paris' }, now).dueAt, { lt: new Date('2026-10-07T22:00:00Z') });
  assert.deepEqual(parseActionFilters({ period: 'upcoming', timeZone: 'Europe/Paris' }, now).dueAt, { gte: new Date('2026-10-08T22:00:00Z') });
});
test('journees de 23/25 heures et changement de date locale', () => {
  for (const [date, hours] of [['2026-03-29T12:00:00Z',23], ['2026-10-25T12:00:00Z',25]]) {
    const { start, end } = dayBounds('Europe/Paris', new Date(date));
    assert.equal((end-start)/3600000, hours);
  }
  assert.equal(dayBounds('Europe/Paris', new Date('2026-10-07T23:00:00Z')).start.toISOString(), '2026-10-07T22:00:00.000Z');
});
async function exercise(database) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method='GET', body) => fetch(base+path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ids=[]; let prospectId;
  try {
    const p = await request('/prospects', 'POST', { firstName: 'Action test', lastName: `Temporary ${Date.now()}` });
    assert.equal(p.status,201); prospectId=(await p.json()).id;
    assert.equal((await request('/actions','POST',{})).status,400);
    assert.equal((await request('/actions/not-an-id')).status,400);
    assert.equal((await request('/actions','POST',{ ...input, prospectId: 2147483647 })).status,404);
    const dates=[new Date(Date.now()-3*86400000).toISOString(),new Date().toISOString(),new Date(Date.now()+3*86400000).toISOString()];
    for (const dueAt of dates) {
      const r=await request('/actions','POST',{ ...input, prospectId, dueAt }); assert.equal(r.status,201); ids.push((await r.json()).id);
    }
    const id=ids[1];
    assert.equal((await request(`/actions/${id}`)).status,200);
    const updated=await request(`/actions/${id}`,'PUT',{ ...input, prospectId, title: 'Updated', dueAt: dates[1] }); assert.equal(updated.status,200); assert.equal((await updated.json()).title,'Updated');
    for (const period of ['overdue','today','upcoming']) {
      const r=await request(`/actions?prospectId=${prospectId}&completed=false&period=${period}&timeZone=Europe%2FParis`); assert.equal(r.status,200); assert.equal((await r.json()).length,1);
    }
    const completed=await request(`/actions/${id}/complete`,'PATCH'); assert.equal(completed.status,200); const finished=(await completed.json()).completedAt; assert.ok(finished);
    assert.equal((await (await request(`/actions/${id}/complete`,'PATCH')).json()).completedAt,finished);
    assert.equal((await (await request(`/actions?prospectId=${prospectId}&completed=true`)).json()).length,1);
    assert.equal((await (await request(`/actions/${id}/reopen`,'PATCH')).json()).completedAt,null);
    assert.equal((await request(`/prospects/${prospectId}`,'DELETE')).status,409);
    if (database) { await prisma.$disconnect(); assert.equal((await (await request(`/actions/${id}`)).json()).title,'Updated'); }
    for (const actionId of ids) assert.equal((await request(`/actions/${actionId}`,'DELETE')).status,204);
    assert.equal((await request(`/actions/${id}`)).status,404);
    for (const method of ['PUT','DELETE','PATCH']) assert.equal((await request(`/actions/${id}${method==='PATCH'?'/reopen':''}`,method,method==='PUT'?{ ...input, prospectId }:undefined)).status,404);
  } finally {
    await prisma.action.deleteMany({ where: { id: { in: ids } } });
    if (prospectId) await prisma.prospect.deleteMany({ where: { id: prospectId } });
    await new Promise(resolve=>server.close(resolve)); await prisma.$disconnect();
  }
}
test('CRUD HTTP, transitions, filtres et persistance PostgreSQL', { skip: process.env.TEST_DATABASE !== '1' }, () => exercise(true));

test('CRUD HTTP avec doubles Prisma (sans modification PostgreSQL)', async () => {
  const { Prisma } = await import('../dist/generated/prisma/client.js');
  const originals=[]; const records=new Map(); let person; let sequence=1;
  const patch=(object,key,fn)=>{ originals.push([object,key,object[key]]); object[key]=fn; };
  const missing=()=>{ throw new Prisma.PrismaClientKnownRequestError('Missing',{ code:'P2025', clientVersion:'7' }); };
  patch(prisma.prospect,'create',async ({data})=>person={ ...data,id:1 });
  patch(prisma.prospect,'findUnique',async ({where})=>person?.id===where.id?person:null);
  patch(prisma.prospect,'delete',async ()=>{ if(records.size) throw new Prisma.PrismaClientKnownRequestError('FK',{ code:'P2003',clientVersion:'7' }); person=null; });
  patch(prisma.prospect,'deleteMany',async ()=>{person=null;});
  patch(prisma.action,'create',async ({data})=>{ const row={...data,id:sequence++,completedAt:null,prospect:person}; records.set(row.id,row); return row; });
  patch(prisma.action,'findUnique',async ({where})=>records.get(where.id)??null);
  patch(prisma.action,'findMany',async ({where})=>[...records.values()].filter(r=>(!where.prospectId || r.prospectId===where.prospectId) && (where.completedAt===undefined || (where.completedAt===null ? r.completedAt===null : r.completedAt!==null)) && (!where.dueAt || ((!where.dueAt.lt || r.dueAt<where.dueAt.lt) && (!where.dueAt.gte || r.dueAt>=where.dueAt.gte)))));
  patch(prisma.action,'update',async ({where,data})=>{ const row=records.get(where.id); if(!row) missing(); Object.assign(row,data); return row; });
  patch(prisma.action,'updateMany',async ({where,data})=>{ const row=records.get(where.id); if(row && row.completedAt===null) Object.assign(row,data); return {count:row?1:0}; });
  patch(prisma.action,'delete',async ({where})=>{ if(!records.has(where.id)) missing(); records.delete(where.id); });
  patch(prisma.action,'deleteMany',async ()=>records.clear());
  try { await exercise(false); } finally { for(const [o,k,fn] of originals) o[k]=fn; }
});
