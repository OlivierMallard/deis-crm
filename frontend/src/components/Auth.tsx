import { createContext, useContext, useEffect, useState, type ReactNode, type FormEvent } from 'react'
type User={id:number;email:string;name:string;role:'ADMIN'|'USER';isActive:boolean}
export const AuthContext=createContext<User|null>(null)
export const useUser=()=>useContext(AuthContext)
let csrf=''
const fetchOwner=globalThis as typeof globalThis & {__crmNativeFetch?:typeof fetch}
const originalFetch=fetchOwner.__crmNativeFetch??globalThis.fetch.bind(globalThis)
if(typeof window!=='undefined')fetchOwner.__crmNativeFetch=originalFetch
if(typeof window!=='undefined') window.fetch=async(input,init)=>{
  const path=typeof input==='string'?input:input instanceof URL?input.pathname:input.url
  if(!path.startsWith('/api/'))return originalFetch(input,init)
  const headers=new Headers(init?.headers)
  if(csrf)headers.set('x-csrf-token',csrf)
  const response=await originalFetch(input,{...init,credentials:'same-origin',headers})
  if(response.status===401&&!path.startsWith('/api/auth/login')&&!path.startsWith('/api/auth/session'))window.dispatchEvent(new Event('crm-session-expired'))
  return response
}
async function api(path:string,method='GET',body?:unknown){const r=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}).catch(()=>{throw new Error('Impossible de joindre l’API. Réessayez.')});if(!r.ok){const error=await r.json().catch(()=>null);throw new Error(error?.message??'La requête a échoué. Réessayez.')}return r.status===204?null:r.json()}
export function AuthGate({children}:{children:ReactNode}){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
  useEffect(()=>{api('auth/session').then(r=>{csrf=r.csrf;setUser(r.user)}).catch(()=>{}).finally(()=>setLoading(false));const expire=()=>{csrf='';setUser(null);setError('Session expirée. Reconnectez-vous.')};window.addEventListener('crm-session-expired',expire);return()=>window.removeEventListener('crm-session-expired',expire)},[])
  async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();const data=new FormData(e.currentTarget);setLoading(true);setError('');try{const r=await api('auth/login','POST',Object.fromEntries(data));csrf=r.csrf;setUser(r.user)}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  if(loading)return <p role="status">Vérification de la session…</p>
  if(!user)return <main className="main-content"><section className="welcome-card"><h1>Connexion CRM DEIS</h1><form className="form-grid" onSubmit={login}><label>Email<input name="email" type="email" autoComplete="username" required/></label><label>Mot de passe<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button className="button" type="submit">Se connecter</button>{error&&<p role="alert">{error}</p>}</form></section></main>
  return <AuthContext.Provider value={user}><div className={'role-'+user.role.toLowerCase()}><div style={{textAlign:'right',padding:8}}>{user.name} · {user.role} <button className="button" onClick={()=>{void api('auth/logout','POST').then(()=>{csrf='';setUser(null)}).catch(e=>setError(e.message))}}>Déconnexion</button>{error&&<p role="alert">{error}</p>}</div>{children}</div></AuthContext.Provider>
}
export function Administration(){
  const [users,setUsers]=useState<User[]>([]),[error,setError]=useState(''),[logs,setLogs]=useState<unknown[]>([])
  const load=()=>api('admin/users').then(setUsers).catch(e=>setError(e.message))
  useEffect(()=>{void load()},[])
  async function change(u:User,body:object){if(!confirm('Confirmer cette modification sensible pour '+u.email+' ?'))return;try{await api('admin/users/'+u.id,'PATCH',body);await load()}catch(e){setError((e as Error).message)}}
  return <section className="welcome-card"><h2>Utilisateurs</h2>{error&&<p role="alert">{error}</p>}<form className="form-grid" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(!confirm('Créer cet utilisateur ?'))return;try{await api('admin/users','POST',Object.fromEntries(new FormData(form)));form.reset();await load()}catch(e){setError((e as Error).message)}}}><label>Nom<input name="name" required maxLength={150}/></label><label>Email<input name="email" type="email" required/></label><label>Mot de passe initial<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><label>Rôle<select name="role"><option>USER</option><option>ADMIN</option></select></label><button className="button">Créer</button></form>{users.map(u=><div key={u.id}><p>{u.name} · {u.email} · {u.role} · {u.isActive?'Actif':'Désactivé'}</p><button className="button" onClick={()=>void change(u,{role:u.role==='ADMIN'?'USER':'ADMIN'})}>Changer le rôle</button><button className="button" onClick={()=>void change(u,{isActive:!u.isActive})}>{u.isActive?'Désactiver':'Activer'}</button><form onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void change(u,{password:new FormData(form).get('password')}).then(()=>form.reset())}}><label>Nouveau mot de passe<input type="password" name="password" minLength={12} maxLength={128} required autoComplete="new-password"/></label><button className="button">Réinitialiser l’accès</button></form></div>)}<button className="button" onClick={()=>void api('admin/audit').then(setLogs).catch(e=>setError(e.message))}>Consulter les 100 derniers événements</button><pre style={{whiteSpace:'pre-wrap'}}>{logs.length?JSON.stringify(logs,null,2):''}</pre></section>
}

export function AdminOnly({children}:{children:ReactNode}){return useUser()?.role==='ADMIN'?<>{children}</>:null}
