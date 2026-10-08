import Reporting from './components/Reporting'
import GlobalSearch from './components/GlobalSearch'
import Finance from './components/Finance'
import FinanceMetrics from './components/FinanceMetrics'
import Clients from './components/Clients'
import Contracts from './components/Contracts'
import CommercialMetrics from './components/CommercialMetrics'
import Actions from './components/Actions'
import ActionMetrics from './components/ActionMetrics'
import { useEffect, useState } from 'react'
import Prospects from './components/Prospects'

const sections = ['Dashboard', 'Prospects', 'Clients', 'Tâches', 'Contrats', 'Devis', 'Factures', 'Reporting'] as const
type Section = (typeof sections)[number]
type ApiStatus = 'loading' | 'connected' | 'unavailable'

const apiStatusLabels: Record<ApiStatus, string> = {
  loading: 'Connexion...',
  connected: 'API connectée',
  unavailable: 'API indisponible',
}

export default function App() {
  const [activeSection, setActiveSection] = useState<Section>('Dashboard')
  const [selected, setSelected] = useState<{kind:string;id:number}|null>(null)
  const [clientId, setClientId] = useState<number | undefined>()
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading')

  useEffect(() => {
    if (activeSection !== 'Dashboard') return

    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 5000)

    setApiStatus('loading')

    async function checkApi() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const health: unknown = await response.json()
        if (!health || typeof health !== 'object' || !('status' in health) || health.status !== 'ok') {
          throw new Error('Réponse de santé API invalide')
        }

        if (active) setApiStatus('connected')
      } catch {
        if (active) setApiStatus('unavailable')
      } finally {
        window.clearTimeout(timeout)
      }
    }

    void checkApi()

    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [activeSection])

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>CRM <strong>DEIS</strong></span>
        </div>
        <p className="sidebar-label">ESPACE COMMERCIAL</p>
        <nav aria-label="Navigation principale">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              className={`nav-item${activeSection === section ? ' active' : ''}`}
              aria-current={activeSection === section ? 'page' : undefined}
              onClick={() => { setSelected(null); setClientId(undefined); setActiveSection(section) }}
            >
              {section}
            </button>
          ))}
        </nav>
        <p className="sidebar-footer">Votre espace de suivi commercial</p>
      </aside>

      <main className="main-content">
        <GlobalSearch onSelect={(kind,id)=>{setSelected({kind,id});setClientId(kind==='clients'?id:undefined);setActiveSection(({prospects:'Prospects',clients:'Clients',contracts:'Contrats',quotes:'Devis',invoices:'Factures'} as Record<string,Section>)[kind])}}/>
        <header className="page-header">
          <p className="eyebrow">CRM DEIS / ESPACE COMMERCIAL</p>
          <h1>{activeSection}</h1>
          <p className="subtitle">
            {activeSection === 'Dashboard'
              ? 'Bienvenue dans votre espace de gestion commerciale.'
              : `Votre espace ${activeSection.toLocaleLowerCase('fr-FR')}.`}
          </p>
        </header>
        {activeSection === 'Dashboard' && (
          <p className={`api-status api-status--${apiStatus}`} role="status">
            {apiStatusLabels[apiStatus]}
          </p>
        )}
        {activeSection === 'Dashboard' && <><ActionMetrics /><CommercialMetrics /><FinanceMetrics /></>}
        {activeSection === 'Prospects' ? <Prospects key={selected?.id} initialId={selected?.kind==='prospects'?selected.id:undefined} onClient={id => { setClientId(id); setActiveSection('Clients') }} /> : activeSection === 'Tâches' ? <Actions /> : activeSection === 'Clients' ? <Clients initialId={clientId} /> : activeSection === 'Contrats' ? <Contracts key={selected?.id} initialId={selected?.kind==='contracts'?selected.id:undefined} /> : activeSection === 'Devis' ? <Finance key={'q'+selected?.id} kind='quotes' initialId={selected?.kind==='quotes'?selected.id:undefined} /> : activeSection === 'Factures' ? <Finance key={'i'+selected?.id} kind='invoices' initialId={selected?.kind==='invoices'?selected.id:undefined} /> : activeSection === 'Reporting' ? <Reporting /> : <section className="welcome-card" aria-labelledby="welcome-title">
          <span className="card-label">VUE D’ENSEMBLE</span>
          <h2 id="welcome-title">
            {activeSection === 'Dashboard' ? 'Votre CRM prend forme' : 'Un espace prêt à évoluer'}
          </h2>
          <p>
            {activeSection === 'Dashboard'
              ? 'Retrouvez les prospects, clients, tâches et contrats depuis le menu de navigation.'
              : 'Les fonctionnalités de cette rubrique seront ajoutées lors des prochaines étapes.'}
          </p>
        </section>}
      </main>
    </div>
  )
}
