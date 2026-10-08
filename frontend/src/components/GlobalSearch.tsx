import { useEffect, useState } from 'react'
type Result={id:number;firstName?:string;lastName?:string;company?:string;reference?:string;title?:string}
const labels:Record<string,string>={prospects:'Prospects',clients:'Clients',contracts:'Contrats',quotes:'Devis',invoices:'Factures'}
export default function GlobalSearch({onSelect}:{onSelect:(kind:string,id:number)=>void}) {
  const [q,setQ]=useState(''),[results,setResults]=useState<Record<string,Result[]>>({}),[loading,setLoading]=useState(false),[error,setError]=useState('')
  useEffect(()=>{const controller=new AbortController();setResults({});setError('');setLoading(!!q.trim());if(!q.trim())return()=>controller.abort();
    const timer=window.setTimeout(async()=>{try {const r=await fetch('/api/search?q='+encodeURIComponent(q),{signal:controller.signal});if(!r.ok)throw new Error((await r.json()).message);const data=await r.json();if(!controller.signal.aborted)setResults(data)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Recherche impossible.')}finally{if(!controller.signal.aborted)setLoading(false)}},300);
    return()=>{controller.abort();window.clearTimeout(timer)}
  },[q])
  return <div className="global-search"><label>Recherche globale<input type="search" placeholder="Nom, société, téléphone, référence…" maxLength={100} value={q} onChange={e=>setQ(e.target.value)}/></label>{q.trim()&&<div className="search-results">{loading?<p role="status">Recherche…</p>:error?<p role="alert">{error}</p>:Object.values(results).every(r=>r.length===0)?<p>Aucun résultat.</p>:Object.entries(results).filter(([,rows])=>rows.length).map(([kind,rows])=><section key={kind}><h3>{labels[kind]}</h3>{rows.map(r=><button key={r.id} className="button search-result" onClick={()=>{onSelect(kind,r.id);setQ('')}}>{r.reference?`${r.reference} · ${r.title}`:`${r.firstName} ${r.lastName}${r.company?' · '+r.company:''}`}</button>)}</section>)}</div>}</div>
}
