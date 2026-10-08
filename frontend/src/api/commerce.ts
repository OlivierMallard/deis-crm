import type { Prospect } from './prospects'
export type ClientInput = { firstName: string; lastName: string; company: string | null; email: string | null; phone: string | null; notes: string | null }
export type Client = ClientInput & { id: number; sourceProspectId: number | null; sourceProspect?: Prospect | null; contracts?: Contract[]; _count: { contracts: number } }
export const contractLabels = { DRAFT: 'Brouillon', PROPOSED: 'Proposé', SIGNED: 'Signé', IN_PROGRESS: 'En cours', COMPLETED: 'Terminé', CANCELLED: 'Annulé' } as const
export type ContractInput = { clientId: number; reference: string | null; title: string; description: string | null; amountCents: number; status: keyof typeof contractLabels; startDate: string | null; endDate: string | null }
export type Contract = ContractInput & { id: number; client?: Client; signedAt: string | null }
export async function commerceRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  if (!response.ok) { const error = await response.json().catch(() => null); throw new Error(error?.message ?? 'API indisponible.') }
  return response.status === 204 ? undefined as T : response.json()
}
export function eurosToCents(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Montant invalide : deux décimales maximum.')
  const [whole, fraction = ''] = normalized.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (cents > 2147483647n) throw new Error('Montant trop élevé.')
  return Number(cents)
}
export const money = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
