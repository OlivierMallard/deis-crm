import { useListTools, ReferenceSelect } from './ListTools'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { actionsApi, actionTypes, type Action, type ActionInput, type Period } from '../api/actions'
import { prospectsApi, type Prospect } from '../api/prospects'
const groups: { key: Period | 'completed'; label: string }[] = [
  { key: 'overdue', label: 'En retard' }, { key: 'today', label: 'Aujourd’hui' },
  { key: 'upcoming', label: 'À venir' }, { key: 'completed', label: 'Historique des actions terminées' },
]
function localInput(date: string) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
export default function Actions({ prospect }: { prospect?: Prospect }) {
  const uid = useId()
  const list = useListTools('actions',{prospectId:String(prospect?.id ?? '')})
  const [lists, setLists] = useState<Action[][]>([])
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Action | null>(null)
  const [input, setInput] = useState<ActionInput>({ prospectId: prospect?.id ?? 0, type: 'CALL', title: '', description: '', dueAt: '' })
  const generation = useRef(0)
  async function refresh() {
    const n = ++generation.current
    setLoading(true); setError('')
    try {
      const [data, people] = await Promise.all([
        list.load<Action>(),
        prospect ? Promise.resolve([prospect]) : prospectsApi.list(),
      ])
      if (n === generation.current) { const rows=list.accept(data); const midnight=new Date();midnight.setHours(0,0,0,0);const tomorrow=new Date(midnight);tomorrow.setDate(tomorrow.getDate()+1);setLists(groups.map(g=>rows.filter(a=>g.key==='completed'?!!a.completedAt:!a.completedAt&&(g.key==='overdue'?new Date(a.dueAt)<midnight:g.key==='today'?new Date(a.dueAt)>=midnight&&new Date(a.dueAt)<tomorrow:new Date(a.dueAt)>=tomorrow)))); setProspects(people) }
    } catch (e) { if (n === generation.current) setError(e instanceof Error ? e.message : 'Erreur API.') }
    finally { if (n === generation.current) setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60000)
    return () => { generation.current++; window.clearInterval(timer) }
  }, [prospect?.id,list.queryString])
  function openForm(action?: Action) {
    setEditing(action ?? null); setError(''); setSuccess('')
    setInput(action ? { prospectId: action.prospectId, type: action.type, title: action.title, description: action.description, dueAt: localInput(action.dueAt) } : { prospectId: prospect?.id ?? prospects[0]?.id ?? 0, type: 'CALL', title: '', description: '', dueAt: '' })
    setOpen(true)
  }
  async function mutate(operation: () => Promise<unknown>, message: string) {
    if (busy) return
    setBusy(true); setError(''); setSuccess('')
    try { await operation(); setSuccess(message); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Erreur API.') }
    finally { setBusy(false) }
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    const date = new Date(input.dueAt)
    if (!Number.isFinite(date.getTime()) || localInput(date.toISOString()) !== input.dueAt) { setError('Date locale invalide ou heure inexistante lors du changement d’heure.'); return }
    await mutate(async () => { await actionsApi.save({ ...input, dueAt: date.toISOString() }, editing?.id); setOpen(false) }, 'Action enregistrée.')
  }
  return <section className="prospects-card" aria-labelledby={`${uid}-title`}>
    <div className="prospects-toolbar"><h2 id={`${uid}-title`}>{prospect ? `Actions de ${prospect.firstName} ${prospect.lastName}` : 'Actions commerciales et relances'}</h2>
      <button className="button button-primary" disabled={busy || loading || open || !prospects.length} onClick={() => openForm()}>Ajouter une action{prospect ? ' pour ce prospect' : ''}</button></div>
    <p className="form-hint">Dates affichées dans votre fuseau : {Intl.DateTimeFormat().resolvedOptions().timeZone}. Le retard commence le lendemain de la date prévue.</p>
    {list.controls}{list.pagination(loading || busy)}
    <p className="form-hint">Les groupes ci-dessous contiennent les actions de la page courante.</p>
    {success && <p className="notice notice-success" role="status">{success}</p>}
    {error && <div className="notice notice-error" role="alert">{error} <button className="button" disabled={busy || loading} onClick={() => void refresh()}>Réessayer</button></div>}
    {open && <form className="prospect-form" onSubmit={save}><h3>{editing ? 'Modifier l’action' : 'Nouvelle action'}</h3><fieldset disabled={busy}><div className="form-grid">
      {!prospect && <ReferenceSelect kind="prospects" label="Prospect *" required value={input.prospectId} onChange={id=>setInput({...input,prospectId:id})}/>}
      <label>Type *<select value={input.type} onChange={e => setInput({ ...input, type: e.target.value as ActionInput['type'] })}>{Object.entries(actionTypes).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>Titre *<input autoFocus required maxLength={500} value={input.title} onChange={e => setInput({ ...input, title: e.target.value })}/></label>
      <label>Date et heure prévues *<input type="datetime-local" required value={input.dueAt} onChange={e => setInput({ ...input, dueAt: e.target.value })}/></label>
      <label className="form-notes">Description<textarea rows={3} maxLength={10000} value={input.description ?? ''} onChange={e => setInput({ ...input, description: e.target.value })}/></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button><button className="button" type="button" onClick={() => setOpen(false)}>Annuler</button></div></fieldset></form>}
    {loading ? <p role="status">Chargement des actions…</p> : !error && groups.map((g,i) => <section key={g.key} className="action-group"><h3>{g.label} ({lists[i]?.length ?? 0})</h3>
      {!lists[i]?.length ? <p className="empty-list">Aucune action.</p> : lists[i].map(a => <article className="action-item" key={a.id}><div><strong>{a.title}</strong><p>{actionTypes[a.type]} · {a.prospect.firstName} {a.prospect.lastName}</p><p>Prévue : {new Date(a.dueAt).toLocaleString('fr-FR')}{a.completedAt && ` · Terminée : ${new Date(a.completedAt).toLocaleString('fr-FR')}`}</p>{a.description && <p className="action-description">{a.description}</p>}</div>
        <div className="form-actions"><button className="button" disabled={busy || open} onClick={() => void mutate(() => actionsApi.transition(a), a.completedAt ? 'Action rouverte.' : 'Action terminée.')}>{a.completedAt ? 'Rouvrir' : 'Marquer comme terminée'}</button><button className="button" disabled={busy || open} onClick={() => openForm(a)}>Modifier</button><button className="button button-danger" disabled={busy || open} onClick={() => { if (window.confirm(`Supprimer définitivement l’action « ${a.title} » ?`)) void mutate(() => actionsApi.delete(a.id), 'Action supprimée.') }}>Supprimer</button></div></article>)}
    </section>)}
    {!loading && !prospects.length && !error && <p className="empty-list">Créez d’abord un prospect dans la rubrique Prospects.</p>}
  </section>
}
