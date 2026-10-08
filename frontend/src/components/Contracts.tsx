import Finance from './Finance'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { commerceRequest as api, contractLabels, eurosToCents, money, type Client, type Contract, type ContractInput } from '../api/commerce'
export default function Contracts({ clientId, onChange }: { clientId?: number; onChange?: () => void }) {
  const [rows, setRows] = useState<Contract[]>([]), [clients, setClients] = useState<Client[]>([])
  const [filterClient, setFilterClient] = useState(String(clientId ?? '')), [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('')
  const [input, setInput] = useState<ContractInput | null>(null), [editing, setEditing] = useState<number | undefined>(), [amount, setAmount] = useState('0.00')
  const [invoiceContract,setInvoiceContract] = useState<Contract | null>(null)
  const generation = useRef(0)
  async function refresh() {
    const n = ++generation.current; setLoading(true)
    try { const query = new URLSearchParams(); if (filterClient) query.set('clientId', filterClient); if (filterStatus) query.set('status', filterStatus)
      const [r,c] = await Promise.all([api<Contract[]>(`contracts?${query}`), api<Client[]>('clients')]); if(n === generation.current) { setRows(r); setClients(c) }
    } catch(e) { if(n === generation.current) setError(e instanceof Error ? e.message : 'Erreur API.') }
    finally { if(n === generation.current) setLoading(false) }
  }
  useEffect(() => { setError(''); void refresh(); return () => { generation.current++ } }, [filterClient, filterStatus])
  function open(row?: Contract) {
    setEditing(row?.id); setError(''); setSuccess(''); setAmount(row ? `${Math.floor(row.amountCents/100)}.${String(row.amountCents%100).padStart(2,'0')}` : '0.00')
    setInput(row ? { clientId: row.clientId, reference: row.reference, title: row.title, description: row.description, amountCents: row.amountCents, status: row.status, startDate: row.startDate?.slice(0,10) ?? '', endDate: row.endDate?.slice(0,10) ?? '' } : { clientId: clientId ?? clients[0]?.id ?? 0, reference: '', title: '', description: '', amountCents: 0, status: 'DRAFT', startDate: '', endDate: '' })
  }
  async function mutate(operation: () => Promise<unknown>, message: string) {
    if(busy) return; setBusy(true); setError(''); setSuccess('')
    try { await operation(); setSuccess(message); await refresh(); onChange?.() } catch(e) { setError(e instanceof Error ? e.message : 'Erreur API.') } finally { setBusy(false) }
  }
  function save(e: FormEvent) { e.preventDefault(); if (!input) return
    void mutate(async () => { await api(`contracts${editing ? `/${editing}` : ''}`, editing ? 'PUT' : 'POST', { ...input, amountCents: eurosToCents(amount), startDate: input.startDate || null, endDate: input.endDate || null }); setInput(null) }, 'Contrat enregistré.')
  }
  return <section className="prospects-card"><div className="prospects-toolbar"><h2>Contrats</h2><button className="button button-primary" disabled={busy || loading || !!input || !clients.length} onClick={() => open()}>Nouveau contrat</button></div>
    {success && <p className="notice notice-success" role="status">{success}</p>}{error && <p className="notice notice-error" role="alert">{error} <button className="button" disabled={busy || loading} onClick={() => void refresh()}>Réessayer</button></p>}
    <div className="form-grid">{!clientId && <label>Client<select value={filterClient} onChange={e => setFilterClient(e.target.value)}><option value="">Tous</option>{clients.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label>}<label>Statut<select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="">Tous</option>{Object.entries(contractLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
    {input && <form className="prospect-form" onSubmit={save}><h3>{editing ? 'Modifier le contrat' : 'Nouveau contrat'}</h3><fieldset disabled={busy}><div className="form-grid">
      <label>Client *<select required value={input.clientId || ''} onChange={e => setInput({ ...input, clientId: Number(e.target.value) })}><option value="" disabled>Choisir</option>{clients.map(c => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label>
      <label>Référence (automatique si vide)<input maxLength={100} value={input.reference ?? ''} onChange={e => setInput({ ...input, reference: e.target.value })}/></label>
      <label>Titre *<input autoFocus required value={input.title} onChange={e => setInput({ ...input, title: e.target.value })}/></label>
      <label>Montant HT en euros *<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}/></label>
      <label>Statut<select value={input.status} onChange={e => setInput({ ...input, status: e.target.value as ContractInput['status'] })}>{Object.entries(contractLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {(['startDate','endDate'] as const).map(k => <label key={k}>{k === 'startDate' ? 'Début' : 'Fin'}<input type="date" value={input[k] ?? ''} onChange={e => setInput({ ...input, [k]: e.target.value })}/></label>)}
      <label className="form-notes">Description<textarea value={input.description ?? ''} onChange={e => setInput({ ...input, description: e.target.value })}/></label>
    </div><div className="form-actions"><button className="button button-primary">Enregistrer</button><button className="button" type="button" onClick={() => setInput(null)}>Annuler</button></div></fieldset></form>}
    {loading ? <p role="status">Chargement des contrats…</p> : !error && !rows.length ? <p className="empty-list">Aucun contrat.</p> : <div className="table-scroll"><table className="prospects-table"><thead><tr>{['Référence / titre','Client','Montant HT','Statut','Dates','Actions'].map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.reference}</strong><p>{r.title}</p>{r.description && <p className="action-description">{r.description}</p>}</td><td>{r.client?.firstName} {r.client?.lastName}</td><td>{money(r.amountCents)}</td><td><span className="status-badge">{contractLabels[r.status]}</span></td><td>{r.startDate?.slice(0,10) ?? '—'} / {r.endDate?.slice(0,10) ?? '—'}</td><td><div className="row-actions"><button className="button" onClick={() => setInvoiceContract(r)}>Factures</button><button className="button" disabled={busy || !!input} onClick={() => open(r)}>Modifier</button><button className="button button-danger" disabled={busy || !!input} onClick={() => { if(window.confirm(`Supprimer le contrat ${r.reference} ?`)) void mutate(() => api(`contracts/${r.id}`, 'DELETE'), 'Contrat supprimé.') }}>Supprimer</button></div></td></tr>)}</tbody></table></div>}
    {invoiceContract && <section className="action-group"><h3>Factures du contrat {invoiceContract.reference}</h3><button className="button" onClick={() => setInvoiceContract(null)}>Fermer</button><Finance key={invoiceContract.id} kind="invoices" clientId={invoiceContract.clientId} contractId={invoiceContract.id}/></section>}
    {!loading && !clients.length && !error && <p className="empty-list">Créez d’abord un client.</p>}
  </section>
}
