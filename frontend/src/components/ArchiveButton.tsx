import { useUser } from './Auth'
import { commerceRequest } from '../api/commerce'
import { useState } from 'react'
export default function ArchiveButton({kind,row,onDone}:{kind:string;row:{id:number;archivedAt?:string|null};onDone:()=>void}){
 const user=useUser(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 if(user?.role!=='ADMIN')return null
 return <><button className="button" disabled={busy} onClick={async()=>{if(!confirm(row.archivedAt?'Restaurer cette fiche ?':'Archiver cette fiche ?'))return;setBusy(true);try{await commerceRequest(`${kind}/${row.id}/archive`,'POST',{archived:!row.archivedAt});onDone()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{row.archivedAt?'Restaurer':'Archiver'}</button>{error&&<span role="alert">{error}</span>}</>
}
