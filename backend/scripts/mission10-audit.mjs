import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const file=new URL('../data/mission10-baseline.json',import.meta.url);
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try {
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const snapshot={};
 for(const name of ['Prospect','Action','Client','Contract','Quote','QuoteLine','Invoice','Payment']){
  const rows=(await db.query(`SELECT to_jsonb(t)-'archivedAt' AS data FROM "${name}" t ORDER BY id`)).rows;
  snapshot[name]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
 }
 await db.query('COMMIT');
 if(process.argv[2]==='baseline')await writeFile(file,JSON.stringify(snapshot));
 else if(JSON.stringify(snapshot)!==await readFile(file,'utf8'))throw new Error('Les données métier ont changé.');
 console.log(process.argv[2],JSON.stringify(snapshot));
}finally{await db.end();}
