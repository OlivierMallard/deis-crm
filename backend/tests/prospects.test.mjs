import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { app } from '../dist/app.js';
import { prisma } from '../dist/lib/prisma.js';
import { parseProspectId, parseProspectInput } from '../dist/validation/prospects.js';

test('validation des identifiants et des champs', () => {
  for (const value of ['0', '-1', '1.2', '1e2', 'abc', '2147483648', undefined]) {
    assert.throws(() => parseProspectId(value));
  }
  assert.equal(parseProspectId('12'), 12);
  const valid = { firstName: ' Alice ', lastName: ' Martin ' };
  assert.deepEqual(parseProspectInput(valid), {
    firstName: 'Alice', lastName: 'Martin', company: null, email: null,
    phone: null, notes: null, status: 'NEW',
  });
  for (const input of [null, [], {}, { ...valid, firstName: ' ' },
    { ...valid, lastName: 42 }, { ...valid, status: 'INVALID' },
    { ...valid, status: null }, { ...valid, email: 'invalid' },
    { ...valid, notes: {} }, { ...valid, phone: 123 }]) {
    assert.throws(() => parseProspectInput(input));
  }
  for (const status of ['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']) {
    assert.equal(parseProspectInput({ ...valid, status }).status, status);
  }
});

test('API REST et persistance PostgreSQL', { skip: process.env.TEST_DATABASE !== '1' }, async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let createdId;
  const request = (path, method = 'GET', body) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await request('/health')).status, 200);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await request('/prospects/invalid', method, method === 'PUT' ? {} : undefined)).status, 400);
    }
    assert.equal((await request('/prospects', 'POST', {})).status, 400);
    assert.equal((await fetch(`${base}/prospects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    })).status, 400);
    const input = { firstName: 'Test API', lastName: `Temporaire ${Date.now()}`,
      company: 'DEIS test', email: 'test@example.com', phone: '0102030405', notes: 'Notes de test' };
    const createdResponse = await request('/prospects', 'POST', input);
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    createdId = created.id;
    assert.equal(created.status, 'NEW');
    assert.equal(createdResponse.headers.get('location'), `/api/prospects/${createdId}`);
    const detail = await request(`/prospects/${createdId}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).notes, input.notes);
    const listResponse = await request('/prospects');
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.ok(list.some((prospect) => prospect.id === createdId));
    for (let index = 1; index < list.length; index++) {
      assert.ok(Date.parse(list[index - 1].createdAt) >= Date.parse(list[index].createdAt));
    }
    assert.equal((await request(`/prospects/${createdId}`, 'PUT', { ...input, status: 'INVALID' })).status, 400);
    for (const status of ['CONTACTED', 'QUALIFIED', 'WON', 'LOST']) {
      const response = await request(`/prospects/${createdId}`, 'PUT', {
        ...input, firstName: 'Test modifié', status, notes: 'Notes modifiées', company: null,
      });
      assert.equal(response.status, 200);
      const updated = await response.json();
      assert.equal(updated.status, status);
      assert.equal(updated.firstName, 'Test modifié');
      assert.equal(updated.company, null);
    }
    // Ferme le pool puis relit depuis une connexion neuve : aucune donnée en mémoire.
    await prisma.$disconnect();
    const persisted = await request(`/prospects/${createdId}`);
    assert.equal(persisted.status, 200);
    assert.equal((await persisted.json()).status, 'LOST');
    const deleted = await request(`/prospects/${createdId}`, 'DELETE');
    assert.equal(deleted.status, 204);
    assert.equal(await deleted.text(), '');
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await request(`/prospects/${createdId}`, method, method === 'PUT' ? input : undefined)).status, 404);
    }
  } finally {
    // Supprime uniquement le prospect créé par ce test, même si une assertion échoue.
    if (createdId !== undefined) await prisma.prospect.deleteMany({ where: { id: createdId } });
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
