import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { parseClientInput, parseContractInput, parseContractFilters } from '../dist/validation/commerce.js';
const person = { firstName: 'Mission 7', lastName: 'Temporary', notes: 'Preserve history' };
const contract = { clientId: 1, title: 'Consulting', amountCents: 12345, status: 'SIGNED' };
test('strict client, contract, dates, amount and filter validation', () => {
  assert.equal(parseClientInput(person).firstName, person.firstName);
  assert.equal(parseContractInput(contract).amountCents, 12345);
  for (const input of [{ ...person, sourceProspectId: 1 }, { ...person, email: 'bad' }, { ...person, firstName: ' ' }]) assert.throws(() => parseClientInput(input));
  for (const input of [null, {}, { ...contract, clientId: '1' }, ...[-1, 1.5, '100', 2147483648, null].map(amountCents => ({ ...contract, amountCents })), { ...contract, status: 'BAD' }, { ...contract, status: null }, { ...contract, currency: 'USD' }, { ...contract, reference: 'bad reference' }, { ...contract, startDate: '2026-02-30' }, { ...contract, startDate: '2026-12-02', endDate: '2026-12-01' }, { ...contract, id: 1 }]) assert.throws(() => parseContractInput(input));
  for (const status of ['DRAFT','PROPOSED','SIGNED','IN_PROGRESS','COMPLETED','CANCELLED']) assert.equal(parseContractInput({ ...contract, status }).status, status);
  for (const filters of [{ clientId: '0' }, { status: ['SIGNED'] }, { status: 'BAD' }, { extra: 'x' }]) assert.throws(() => parseContractFilters(filters));
});
async function exercise(database) {
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method = 'GET', body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = async (path, method, body, expected = 200) => { const r = await request(path, method, body); assert.equal(r.status, expected, await r.clone().text()); if(expected===204)return null; const payload=await r.json(); return payload.items ?? payload; };
  const prospectIds = [], clientIds = [], contractIds = [], actionIds = [];
  try {
    const before = await data('/dashboard/commercial');
    const p = await data('/prospects','POST',person,201); prospectIds.push(p.id);
    const a = await data('/actions','POST',{ prospectId: p.id, type: 'CALL', title: 'History', dueAt: '2026-10-08T10:00:00Z' },201); actionIds.push(a.id);
    const transaction = prisma.$transaction;
    prisma.$transaction = function (fn, ...options) {
      if (typeof fn !== 'function') return transaction.call(this, fn, ...options);
      return transaction.call(this, tx => fn(new Proxy(tx, {
        get(target, key) {
          if (key !== 'prospect') return target[key];
          return new Proxy(target.prospect, { get(delegate, method) {
            if (method === 'update') return async () => { throw new Error('Injected write failure'); };
            return delegate[method];
          } });
        },
      })), ...options);
    };
    try { assert.equal((await request(`/prospects/${p.id}/convert`, 'POST')).status, 500); }
    finally { prisma.$transaction = transaction; }
    assert.equal((await data(`/prospects/${p.id}`)).status, 'NEW');
    assert.equal((await data(`/prospects/${p.id}`)).convertedClient, null);
    assert.equal((await data('/dashboard/commercial')).totalClients, before.totalClients);
    const conversions = await Promise.all([request(`/prospects/${p.id}/convert`,'POST'),request(`/prospects/${p.id}/convert`,'POST')]);
    assert.deepEqual(conversions.map(r => r.status).sort(), [201,409]);
    const c = await conversions.find(r => r.status === 201).json(); clientIds.push(c.id);
    assert.equal(c.sourceProspectId,p.id); assert.equal(c.notes,person.notes);
    assert.equal((await data(`/prospects/${p.id}`)).status,'WON');
    assert.equal((await data(`/prospects/${p.id}`)).convertedClient.id,c.id);
    assert.equal((await data(`/actions/${a.id}`)).title,'History');
    assert.equal((await request(`/prospects/${p.id}/convert`,'POST')).status,409);
    assert.equal((await request('/prospects/2147483647/convert','POST')).status,404);
    assert.equal((await request(`/prospects/${p.id}`,'DELETE')).status,409);
    assert.equal((await request(`/clients/${c.id}`,'DELETE')).status,409);
    const direct = await data('/clients','POST',person,201); clientIds.push(direct.id); assert.equal(direct.sourceProspectId,null);
    assert.ok((await data('/clients')).some(r => r.id === direct.id));
    assert.equal((await data(`/clients/${direct.id}`,'PUT',{ ...person, company: 'Updated' })).company,'Updated');
    for (const [index,status] of ['DRAFT','PROPOSED','SIGNED','IN_PROGRESS','COMPLETED','CANCELLED'].entries()) {
      const r = await data('/contracts','POST',{ ...contract, clientId: direct.id, status, amountCents: (index+1)*100 },201); contractIds.push(r.id); assert.ok(r.reference);
    }
    assert.equal(new Set((await data(`/contracts?clientId=${direct.id}`)).map(r => r.reference)).size,6);
    assert.equal((await data(`/contracts?clientId=${direct.id}&status=SIGNED`)).length,1);
    assert.equal((await data(`/clients/${direct.id}`)).contracts.length,6);
    assert.equal((await request(`/clients/${direct.id}`,'DELETE')).status,409);
    const metrics = await data('/dashboard/commercial');
    assert.equal(metrics.totalClients,before.totalClients+2); assert.equal(metrics.activeContracts,before.activeContracts+2);
    assert.equal(metrics.signedAmountCents,before.signedAmountCents+1200); assert.equal(metrics.proposedAmountCents,before.proposedAmountCents+200);
    const r = await data(`/contracts/${contractIds[2]}`); assert.ok(r.signedAt);
    assert.equal((await request('/contracts','POST',{ ...contract, clientId: direct.id, reference: r.reference })).status,409);
    assert.equal((await request('/contracts','POST',{ ...contract, clientId: 2147483647 })).status,404);
    assert.equal((await request('/contracts','POST',{ ...contract, amountCents: -1 })).status,400);
    const updated = await data(`/contracts/${r.id}`,'PUT',{ ...contract, clientId: direct.id, title: 'Updated', status: 'CANCELLED', amountCents: 300 }); assert.equal(updated.reference,r.reference); assert.equal(updated.signedAt,r.signedAt);
    assert.equal((await data('/dashboard/commercial')).signedAmountCents,before.signedAmountCents+900);
    if (database) { await prisma.$disconnect(); assert.equal((await data(`/contracts/${r.id}`)).title,'Updated'); assert.equal((await data(`/clients/${c.id}`)).sourceProspectId,p.id); }
    for(const id of contractIds) await data(`/contracts/${id}`,'DELETE',undefined,204);
    assert.equal((await request(`/contracts/${r.id}`)).status,404);
    await data(`/clients/${direct.id}`,'DELETE',undefined,204);
    assert.equal((await request(`/clients/${direct.id}`)).status,404);
    assert.equal((await request(`/clients/${c.id}`,'DELETE')).status,409);
  } finally {
    // Only records created by this test, in FK order. No pre-existing data touched.
    await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    await prisma.action.deleteMany({ where: { id: { in: actionIds } } });
    await prisma.prospect.deleteMany({ where: { id: { in: prospectIds } } });
    await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
  }
}
test('conversion, CRUD, metrics and PostgreSQL persistence', { skip: process.env.TEST_DATABASE !== '1' }, () => exercise(true));
test('HTTP conversion, CRUD and metrics with Prisma doubles', async () => {
  const originals = []; const tables = { prospect: new Map(), action: new Map(), client: new Map(), contract: new Map() }; let sequence = 1;
  const patch = (o,k,fn) => { originals.push([o,k,o[k]]); o[k]=fn; };
  const fail = code => { throw new Prisma.PrismaClientKnownRequestError(code,{ code,clientVersion:'7' }); };
  const match = (row,where = {}) => Object.entries(where).every(([k,v]) => v && typeof v === 'object' ? v.in.includes(row[k]) : row[k] === v);
  function decorate(name,row) {
    if(!row) return null;
    const result = { ...row };
    if(name === 'prospect') result.convertedClient = [...tables.client.values()].find(c => c.sourceProspectId === row.id) ?? null;
    if(name === 'client') { result._count = { contracts: [...tables.contract.values()].filter(c => c.clientId === row.id).length }; result.sourceProspect = tables.prospect.get(row.sourceProspectId) ?? null; result.contracts = [...tables.contract.values()].filter(c => c.clientId === row.id); }
    if(name === 'action') result.prospect = tables.prospect.get(row.prospectId);
    if(name === 'contract') result.client = tables.client.get(row.clientId);
    return result;
  }
  for(const [name,table] of Object.entries(tables)) {
    const delegate = prisma[name];
    patch(delegate,'findUnique',async ({where}) => decorate(name,table.get(where.id)));
    patch(delegate,'findMany',async ({where} = {}) => [...table.values()].filter(r => match(r,where)).map(r => decorate(name,r)));
    patch(delegate,'create',async ({data}) => {
      if(name === 'client' && data.sourceProspectId && [...table.values()].some(c => c.sourceProspectId === data.sourceProspectId)) fail('P2002');
      if(name === 'contract' && [...table.values()].some(c => c.reference === data.reference)) fail('P2002');
      const row = { sourceProspectId: null, status: 'NEW', ...data, id: sequence++ }; table.set(row.id,row); return decorate(name,row);
    });
    patch(delegate,'update',async ({where,data}) => { const row = table.get(where.id); if(!row) fail('P2025'); Object.assign(row,data); return decorate(name,row); });
    patch(delegate,'delete',async ({where}) => { if(!table.has(where.id)) fail('P2025'); if(name === 'prospect' && [...tables.client.values()].some(c => c.sourceProspectId === where.id)) fail('P2003'); if(name === 'client' && [...tables.contract.values()].some(c => c.clientId === where.id)) fail('P2003'); table.delete(where.id); });
    patch(delegate,'deleteMany',async ({where}) => { for(const [id,row] of table) if(match(row,where)) table.delete(id); });
    patch(delegate,'count',async ({where} = {}) => [...table.values()].filter(r => match(r,where)).length);
  }
  patch(prisma.contract,'aggregate',async ({where}) => ({ _sum: { amountCents: [...tables.contract.values()].filter(r => match(r,where)).reduce((sum,r) => sum+r.amountCents,0) } }));
  patch(prisma,'$transaction',async fn => {
    if(typeof fn !== 'function') return Promise.all(fn);
    const snapshots = Object.fromEntries(Object.entries(tables).map(([name,table]) => [name,new Map([...table].map(([id,row]) => [id,{ ...row }]))]));
    try { return await fn(prisma); } catch(e) { for(const [name,table] of Object.entries(tables)) { table.clear(); for(const [id,row] of snapshots[name]) table.set(id,row); } throw e; }
  });
  try { await exercise(false); } finally { for(const [o,k,fn] of originals) o[k]=fn; }
});


test('exact euro input conversion without floating-point multiplication', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: ts } = await import('../../frontend/node_modules/typescript/lib/typescript.js');
  const source = await readFile(new URL('../../frontend/src/api/commerce.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  const { eurosToCents } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  for (const [value,cents] of [['0',0],['0.29',29],['12,34',1234],['21474836.47',2147483647]]) assert.equal(eurosToCents(value),cents);
  for (const value of ['-1','0.001','1e2','','21474836.48','Infinity']) assert.throws(() => eurosToCents(value));
});
