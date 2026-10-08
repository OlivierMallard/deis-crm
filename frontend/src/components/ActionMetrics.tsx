import { useEffect, useState } from 'react'
import { actionsApi } from '../api/actions'
export default function ActionMetrics() {
  const [counts, setCounts] = useState<number[] | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const rows = await Promise.all((['today', 'overdue', 'upcoming'] as const).map(period => actionsApi.list({ completed: false, period })))
        if (active) { setCounts(rows.map(r => r.total)); setError('') }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Erreur API.') }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [revision])
  return <section className="prospects-card" aria-label="Indicateurs des actions commerciales">
    {error ? <p className="notice notice-error" role="alert">{error} <button className="button" onClick={() => setRevision(r => r+1)}>Réessayer</button></p> : counts ? <div className="metrics-grid">{['À faire aujourd’hui', 'En retard', 'À venir'].map((label,i) => <div className="metric" key={label}><strong>{counts[i]}</strong><span>{label}</span></div>)}</div> : <p role="status">Chargement des indicateurs…</p>}
  </section>
}
