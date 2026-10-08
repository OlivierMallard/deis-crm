import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../frontend/node_modules/esbuild/lib/main.js';

test('React renders search, pagination, filters in all sections and reporting navigation',async()=>{
  const temporary=await mkdtemp(join(tmpdir(),'crm-m9-ui-'));
  try {
    const result=await build({stdin:{contents:`
      import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
      import App from './src/App';import Prospects from './src/components/Prospects';import Clients from './src/components/Clients';
      import Contracts from './src/components/Contracts';import Finance from './src/components/Finance';import Actions from './src/components/Actions';import Reporting from './src/components/Reporting';
      import {SearchInput,DateRangeFilter,Pagination} from './src/components/ListTools';
      export const app=renderToStaticMarkup(<App/>);
      export const sections=[<Prospects onClient={()=>{}}/>,<Clients/>,<Contracts/>,<Finance kind="quotes"/>,<Finance kind="invoices"/>,<Actions/>].map(c=>renderToStaticMarkup(c));
      export const reporting=renderToStaticMarkup(<Reporting/>);
      export const controls=renderToStaticMarkup(<><SearchInput value="Alice" onChange={()=>{}}/><DateRangeFilter label="Création" from="2026-03-01" to="2026-03-31" onChange={()=>{}}/><Pagination page={2} total={55} totalPages={3} onChange={()=>{}}/></>);
    `,resolveDir:resolve('../frontend'),loader:'tsx'},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
    const path=join(temporary,'ui.cjs');await writeFile(path,result.outputFiles[0].contents);
    const rendered=await import(pathToFileURL(path).href);
    assert.match(rendered.app,/Recherche globale/);assert.match(rendered.app,/Reporting/);
    for(const section of rendered.sections){assert.match(section,/Réinitialiser les filtres/);assert.match(section,/Exporter CSV/);assert.match(section,/aria-label="Pagination"/)}
    assert.match(rendered.sections[5],/Terminée/);assert.match(rendered.sections[5],/Période/);assert.match(rendered.sections[4],/Règlement/);
    assert.match(rendered.reporting,/12 derniers mois/);assert.match(rendered.reporting,/Période personnalisée/);assert.match(rendered.reporting,/statut actuel/);
    assert.match(rendered.controls,/value="Alice"/);assert.match(rendered.controls,/2026-03-31/);assert.match(rendered.controls,/Page 2 \/ 3/);
  } finally {await rm(temporary,{recursive:true,force:true})}
});
