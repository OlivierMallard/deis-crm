import Actions from './Actions'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { prospectsApi, statusLabels, type Prospect, type ProspectInput, type ProspectStatus } from '../api/prospects'

const emptyInput: ProspectInput = {
  firstName: '', lastName: '', company: '', email: '', phone: '', status: 'NEW', notes: '',
}
const fields = [
  ['firstName', 'Prénom', 'text'], ['lastName', 'Nom', 'text'], ['company', 'Société', 'text'],
  ['email', 'Email', 'email'], ['phone', 'Téléphone', 'tel'],
] as const

export default function Prospects() {
  const [actionProspect, setActionProspect] = useState<Prospect | null>(null)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [editing, setEditing] = useState<Prospect | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [input, setInput] = useState<ProspectInput>(emptyInput)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const firstNameRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const current = ++generation.current
    setLoading(true)
    setError('')
    try {
      const data = await prospectsApi.list()
      if (current === generation.current) setProspects(data)
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : 'Erreur API.')
    } finally {
      if (current === generation.current) setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    return () => { generation.current++ }
  }, [])

  useEffect(() => { if (formOpen) firstNameRef.current?.focus() }, [formOpen, editing])

  function openForm(prospect?: Prospect) {
    setEditing(prospect ?? null)
    setInput(prospect ? {
      firstName: prospect.firstName, lastName: prospect.lastName, company: prospect.company,
      email: prospect.email, phone: prospect.phone, status: prospect.status, notes: prospect.notes,
    } : { ...emptyInput })
    setFormError('')
    setSuccess('')
    setFormOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFormError('')
    setSuccess('')
    try {
      await prospectsApi.save(input, editing?.id)
      setFormOpen(false)
      setSuccess(editing ? 'Prospect modifié.' : 'Prospect créé.')
      await refresh()
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Enregistrement impossible.')
    } finally { setBusy(false) }
  }

  async function remove(prospect: Prospect) {
    if (busy || !window.confirm(`Supprimer définitivement le prospect ${prospect.firstName} ${prospect.lastName} ?`)) return
    setBusy(true)
    setSuccess('')
    setError('')
    try {
      await prospectsApi.delete(prospect.id)
      setSuccess('Prospect supprimé.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Suppression impossible.')
    } finally { setBusy(false) }
  }

  return (
    <section className="prospects-card" aria-labelledby="prospects-title">
      <div className="prospects-toolbar">
        <h2 id="prospects-title">Suivi des prospects</h2>
        <button className="button button-primary" disabled={busy || formOpen} onClick={() => openForm()}>Nouveau prospect</button>
      </div>
      {success && <p className="notice notice-success" role="status">{success}</p>}
      {error && <div className="notice notice-error" role="alert">{error} <button className="button" disabled={loading || busy} onClick={() => void refresh()}>Réessayer</button></div>}
      {formOpen && (
        <form className="prospect-form" onSubmit={save} aria-labelledby="form-title">
          <h3 id="form-title">{editing ? 'Modifier le prospect' : 'Nouveau prospect'}</h3>
          <fieldset disabled={busy}>
            <div className="form-grid">
              {fields.map(([key, label, type]) => (
                <label key={key} htmlFor={`prospect-${key}`}>
                  {label}{key === 'firstName' || key === 'lastName' ? ' *' : ''}
                  <input id={`prospect-${key}`} ref={key === 'firstName' ? firstNameRef : undefined} type={type}
                    required={key === 'firstName' || key === 'lastName'} value={input[key] ?? ''}
                    onChange={(event) => setInput({ ...input, [key]: event.target.value })} />
                </label>
              ))}
              <label htmlFor="prospect-status">Statut
                <select id="prospect-status" value={input.status} onChange={(event) => setInput({ ...input, status: event.target.value as ProspectStatus })}>
                  {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="form-notes" htmlFor="prospect-notes">Notes
                <textarea id="prospect-notes" rows={4} value={input.notes ?? ''} onChange={(event) => setInput({ ...input, notes: event.target.value })} />
              </label>
            </div>
            <p className="form-hint">* Champs obligatoires</p>
            {formError && <p className="notice notice-error" role="alert">{formError}</p>}
            <div className="form-actions">
              <button className="button button-primary" type="submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button className="button" type="button" onClick={() => setFormOpen(false)}>Annuler</button>
            </div>
          </fieldset>
        </form>
      )}
      {loading ? <p role="status">Chargement des prospects…</p> : !error && prospects.length === 0 ? (
        <p className="empty-list">Aucun prospect pour le moment. Ajoutez votre premier prospect.</p>
      ) : prospects.length > 0 && (
        <div className="table-scroll">
          <table className="prospects-table">
            <caption className="sr-only">Liste des prospects, les plus récents en premier</caption>
            <thead><tr>{['Prénom', 'Nom', 'Société', 'Email', 'Téléphone', 'Statut', 'Actions'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{prospects.map((prospect) => (
              <tr key={prospect.id}>
                <td>{prospect.firstName}</td><td>{prospect.lastName}</td><td>{prospect.company || '—'}</td>
                <td>{prospect.email || '—'}</td><td>{prospect.phone || '—'}</td>
                <td><span className={`status-badge status-${prospect.status.toLowerCase()}`}>{statusLabels[prospect.status]}</span></td>
                <td><div className="row-actions">
                  <button className="button" disabled={busy || formOpen} onClick={() => setActionProspect(prospect)}>Actions commerciales</button>
                  <button className="button" disabled={busy || formOpen} aria-label={`Modifier ${prospect.firstName} ${prospect.lastName}`} onClick={() => openForm(prospect)}>Modifier</button>
                  <button className="button button-danger" disabled={busy || formOpen} aria-label={`Supprimer ${prospect.firstName} ${prospect.lastName}`} onClick={() => void remove(prospect)}>Supprimer</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {actionProspect && <><button className="button" onClick={() => setActionProspect(null)}>Fermer les actions du prospect</button><Actions key={actionProspect.id} prospect={actionProspect} /></>}
    </section>
  )
}
