import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Read-only audit. Stores only row counts and hashes, never customer data.
const baselinePath = join(tmpdir(), 'crm-deis-mission8-baseline.json');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const names = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows.map(r => r.tablename);
  const existing = ['Prospect', 'Action', 'Client', 'Contract'];
  for (const name of existing) assert.ok(names.includes(name), `Missing table: ${name}`);
  const snapshot = {};
  for (const name of [...existing, 'Quote', 'QuoteLine', 'Invoice', 'Payment'].filter(n => names.includes(n))) {
    const rows = (await client.query(`SELECT row_to_json(t) AS data FROM "${name}" t ORDER BY id`)).rows.map(r => r.data);
    const columns = (await client.query('SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', ['public', name])).rows;
    snapshot[name] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), columnsSha256: createHash('sha256').update(JSON.stringify(columns)).digest('hex') };
  }
  await client.query('COMMIT');
  if (process.argv[2] === 'baseline') {
    await writeFile(baselinePath, JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify({ phase: 'before migration', tables: names, snapshot }, null, 2));
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    for (const [name, value] of Object.entries(baseline)) assert.deepEqual(snapshot[name], value, `Changed pre-existing data/schema: ${name}`);
    for (const name of ['Quote', 'QuoteLine', 'Invoice', 'Payment']) assert.ok(names.includes(name), `Missing financial table: ${name}`);
    console.log(JSON.stringify({ phase: process.argv[2], preExistingDataAndColumnsUnchanged: true, tables: names, snapshot }, null, 2));
  }
} finally { await client.end(); }
