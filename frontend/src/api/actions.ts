import type { Prospect } from './prospects'
export const actionTypes = { CALL: 'Appel', EMAIL: 'Email', MEETING: 'Rendez-vous', TASK: 'Tâche', OTHER: 'Autre' } as const
export type ActionInput = { prospectId: number; type: keyof typeof actionTypes; title: string; description: string | null; dueAt: string }
export type Action = ActionInput & { id: number; completedAt: string | null; createdAt: string; updatedAt: string; prospect: Pick<Prospect, 'id' | 'firstName' | 'lastName' | 'company'> }
export type Period = 'overdue' | 'today' | 'upcoming'
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/actions${path}`, options).catch(() => { throw new Error('Impossible de joindre l’API.') })
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.message || 'Erreur API.') }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export const actionsApi = {
  list: (filters: { prospectId?: number; completed?: boolean; period?: Period } = {}) => {
    const query = new URLSearchParams({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    Object.entries(filters).forEach(([k,v]) => { if (v !== undefined) query.set(k,String(v)) })
    return request<{items:Action[];total:number}>(`?${query}`, { cache: 'no-store' })
  },
  save: (input: ActionInput, id?: number) => request<Action>(id ? `/${id}` : '', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
  delete: (id: number) => request<void>(`/${id}`, { method: 'DELETE' }),
  transition: (action: Action) => request<Action>(`/${action.id}/${action.completedAt ? 'reopen' : 'complete'}`, { method: 'PATCH' }),
}
