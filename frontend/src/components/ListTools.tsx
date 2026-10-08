import { useEffect, useState, type ReactNode } from 'react'
import { commerceRequest } from '../api/commerce'

export type Page<T> = {items:T[];total:number;page:number;pageSize:number;totalPages:number}
export function SearchInput({value,onChange,label='Recherche'}:{value:string;onChange:(v:string)=>void;label?:string}) {
  const [draft,setDraft]=useState(value)
  useEffect(()=>setDraft(value),[value])
  useEffect(()=>{const timer=window.setTimeout(()=>{if(draft!==value)onChange(draft)},300);return()=>window.clearTimeout(timer)},[draft,value,onChange])
  return <label>{label}<input type="search" maxLength={200} value={draft} onChange={e=>setDraft(e.target.value)} /></label>
}
export function FilterBar({children,onReset}:{children:ReactNode;onReset:()=>void}) {return <div className="filter-bar form-grid">{children}<button className="button" type="button" onClick={onReset}>Réinitialiser les filtres</button></div>}
export function DateRangeFilter({label,from,to,onChange}:{label:string;from:string;to:string;onChange:(from:string,to:string)=>void}) {return <fieldset className="date-range"><legend>{label}</legend><label>Du<input type="date" value={from} onChange={e=>onChange(e.target.value,to)}/></label><label>Au<input type="date" value={to} onChange={e=>onChange(from,e.target.value)}/></label></fieldset>}
export function Pagination({page,total,totalPages,onChange,disabled}:{page:number;total:number;totalPages:number;onChange:(p:number)=>void;disabled?:boolean}) {return <nav className="pagination" aria-label="Pagination"><span>{total} résultat{total>1?'s':''} · Page {page} / {Math.max(1,totalPages)}</span><button className="button" disabled={disabled || page<=1} onClick={()=>onChange(page-1)}>Précédente</button><button className="button" disabled={disabled || page>=totalPages} onClick={()=>onChange(page+1)}>Suivante</button></nav>}
const labels:Record<string,string>={NEW:'Nouveau',CONTACTED:'Contacté',QUALIFIED:'Qualifié',WON:'Gagné',LOST:'Perdu',DRAFT:'Brouillon',PROPOSED:'Proposé',SIGNED:'Signé',IN_PROGRESS:'En cours',COMPLETED:'Terminé',CANCELLED:'Annulé',SENT:'Envoyé',ACCEPTED:'Accepté',REJECTED:'Refusé',EXPIRED:'Expiré',ISSUED:'Émise',UNPAID:'Non réglée',PARTIAL:'Partiellement réglée',PAID:'Réglée',CALL:'Appel',EMAIL:'Email',MEETING:'Rendez-vous',TASK:'Tâche',OTHER:'Autre',overdue:'En retard',today:'Aujourd’hui',upcoming:'À venir',true:'Oui',false:'Non'}
const statuses:Record<string,string[]>={prospects:['NEW','CONTACTED','QUALIFIED','WON','LOST'],contracts:['DRAFT','PROPOSED','SIGNED','IN_PROGRESS','COMPLETED','CANCELLED'],quotes:['DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED'],invoices:['DRAFT','ISSUED','CANCELLED']}
export function useListTools(kind:string,base:Record<string,string>={}) {
  const [filters,setFilters]=useState<Record<string,string>>({}),[page,setPage]=useState(1),[meta,setMeta]=useState({total:0,totalPages:0})
  const change=(key:string,value:string)=>{setFilters(f=>({...f,[key]:value}));setPage(1)}
  const query=new URLSearchParams({timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,page:String(page),pageSize:'25'})
  for(const [key,value] of Object.entries({...filters,...Object.fromEntries(Object.entries(base).filter(([,v])=>v))}))if(value)query.set(key,value)
  const queryString=query.toString()
  async function load<T>() {const response=await commerceRequest<Page<T>>(`${kind}?${queryString}`);return response}
  function accept<T>(response:Page<T>) {setMeta({total:response.total,totalPages:response.totalPages});if(page>Math.max(1,response.totalPages))setPage(Math.max(1,response.totalPages));return response.items}
  const [exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false)
  async function exportCsv() {setExporting(true);setExportError('');try {const response=await fetch(`/api/${kind}/export?${queryString}`);if(!response.ok){const error=await response.json();throw new Error(error.message)}const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=kind+'.csv';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){setExportError(e instanceof Error?e.message:'Export impossible.')}finally{setExporting(false)}}
  const select=(key:string,label:string,values:string[])=> <label>{label}<select value={filters[key]??''} onChange={e=>change(key,e.target.value)}><option value="">Tous</option>{values.map(v=><option key={v} value={v}>{labels[v]??({asc:'Croissant',desc:'Décroissant'} as Record<string,string>)[v]??v}</option>)}</select></label>
  const range=(prefix:string,label:string)=><DateRangeFilter label={label} from={filters[prefix+'From']??''} to={filters[prefix+'To']??''} onChange={(from,to)=>{setFilters(f=>({...f,[prefix+'From']:from,[prefix+'To']:to}));setPage(1)}}/>
  const controls=<><FilterBar onReset={()=>{setFilters({});setPage(1)}}>
    <SearchInput value={filters.q??''} onChange={v=>change('q',v)}/>
    {statuses[kind]&&select('status','Statut',statuses[kind])}
    {['prospects','clients'].includes(kind)&&range('created','Création')}
    {kind==='contracts'&&<>{range('start','Début')}{range('end','Fin')}</>}
    {['quotes','invoices'].includes(kind)&&range('date','Émission')}
    {kind==='invoices'&&<>{range('due','Échéance')}{select('paymentStatus','Règlement',['UNPAID','PARTIAL','PAID'])}{select('overdue','En retard',['true','false'])}</>}
    {kind==='actions'&&<>{select('type','Type',['CALL','EMAIL','MEETING','TASK','OTHER'])}{select('completed','Terminée',['true','false'])}{select('period','Période',['overdue','today','upcoming'])}{!base.prospectId&&<ReferenceSelect kind="prospects" label="Prospect" value={Number(filters.prospectId)||0} onChange={id=>change('prospectId',id?String(id):'')}/>}</>}
    {['contracts','quotes','invoices'].includes(kind)&&<>{!base.clientId&&<ReferenceSelect kind="clients" label="Client" value={Number(filters.clientId)||0} onChange={id=>change('clientId',id?String(id):'')}/>}{['amountMin','amountMax'].map((key,i)=><label key={key}>Montant HT {i?'maximum':'minimum'} (€)<input type="number" min="0" step="0.01" value={!filters[key]?'':String(Number(filters[key])/100)} onChange={e=>change(key,e.target.value===''?'':String(Math.round(Number(e.target.value)*100)))}/></label>)}</>}
    <label>Tri<select value={filters.sort??''} onChange={e=>change('sort',e.target.value)}><option value="">Ordre habituel</option>{(kind==='actions'?['due']:kind==='prospects'?['name','date','updated']:kind==='clients'?['name','date','contracts']:kind==='contracts'?['date','amount','status']:kind==='invoices'?['date','due','amount']:['date','amount']).map(v=><option key={v} value={v}>{{name:'Nom',date:'Date',updated:'Mise à jour',contracts:'Nombre de contrats',amount:'Montant HT',status:'Statut',due:'Échéance'}[v]}</option>)}</select></label>
    {select('direction','Ordre',['asc','desc'])}
    <button className="button" disabled={exporting} onClick={()=>void exportCsv()}>{exporting?'Export…':'Exporter CSV'}</button>
  </FilterBar>{exportError&&<p className="notice notice-error" role="alert">{exportError}</p>}</>
  return {queryString,load,accept,controls,pagination:(disabled:boolean)=><Pagination page={page} total={meta.total} totalPages={meta.totalPages} onChange={setPage} disabled={disabled}/>}
}

// Reference selectors are capped, searched on the server; never used to filter list data.
export async function referenceItems<T>(kind:string,q='') {return (await commerceRequest<Page<T>>(`${kind}?pageSize=100&q=${encodeURIComponent(q)}`)).items}

type Reference={id:number;firstName?:string;lastName?:string;company?:string;reference?:string;title?:string}
export function ReferenceSelect({kind,value,onChange,label,required=false,base={}}:{kind:string;value:number;onChange:(id:number)=>void;label:string;required?:boolean;base?:Record<string,string>}) {
  const [q,setQ]=useState(''),[rows,setRows]=useState<Reference[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const baseKey=new URLSearchParams(base).toString()
  useEffect(()=>{let active=true;setLoading(true);setError('');const query=new URLSearchParams(baseKey);query.set('q',q);query.set('pageSize','25');
    Promise.all([commerceRequest<Page<Reference>>(`${kind}?${query}`),value?commerceRequest<Reference>(`${kind}/${value}`):Promise.resolve(null)]).then(([page,selected])=>{if(active)setRows(selected&&!page.items.some(r=>r.id===selected.id)?[selected,...page.items]:page.items)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}
  },[kind,q,value,baseKey])
  return <div className="reference-select"><SearchInput label={`Rechercher : ${label}`} value={q} onChange={setQ}/><label>{label}<select required={required} value={value||''} onChange={e=>onChange(Number(e.target.value))}><option value="">{required?'Choisir':'Tous / aucun'}</option>{rows.map(r=><option key={r.id} value={r.id}>{r.reference?`${r.reference} · ${r.title}`:`${r.firstName} ${r.lastName}${r.company?' · '+r.company:''}`}</option>)}</select></label>{loading&&<small role="status">Recherche…</small>}{error&&<small role="alert">{error}</small>}</div>
}
