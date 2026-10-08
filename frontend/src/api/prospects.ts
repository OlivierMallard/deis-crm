export const statusLabels = {
  NEW: 'Nouveau', CONTACTED: 'Contacté', QUALIFIED: 'Qualifié', WON: 'Gagné', LOST: 'Perdu',
} as const
export type ProspectStatus = keyof typeof statusLabels
export type ProspectInput = {
  firstName: string
  lastName: string
  company: string | null
  email: string | null
  phone: string | null
  status: ProspectStatus
  notes: string | null
}
export type Prospect = ProspectInput & { id: number; createdAt: string; updatedAt: string }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/prospects${path}`, options)
  } catch {
    throw new Error('Impossible de joindre l’API. Vérifiez que le backend est démarré.')
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(error?.message || 'La requête a échoué. Veuillez réessayer.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const prospectsApi = {
  list: () => request<Prospect[]>('', { cache: 'no-store' }),
  save: (input: ProspectInput, id?: number) => request<Prospect>(id === undefined ? '' : `/${id}`, {
    method: id === undefined ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  delete: (id: number) => request<void>(`/${id}`, { method: 'DELETE' }),
}
