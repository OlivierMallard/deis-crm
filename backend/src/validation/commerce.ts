import { ContractStatus } from '../generated/prisma/enums.js';
import { ValidationError, parseProspectId, parseProspectInput } from './prospects.js';
export const parseId = parseProspectId;
function object(body: unknown, allowed: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Un objet JSON est attendu.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(k => !allowed.includes(k))) throw new ValidationError('Champ inconnu ou non modifiable.');
  return input;
}
export function parseClientInput(body: unknown) {
  const input = object(body, ['firstName','lastName','company','email','phone','notes']);
  const { status: _, ...data } = parseProspectInput(input);
  for (const value of Object.values(data)) if (value && value.length > 10000) throw new ValidationError('Texte trop long.');
  return data;
}
export function parseStatus(value: unknown): ContractStatus {
  if (typeof value !== 'string' || !Object.values(ContractStatus).includes(value as ContractStatus)) throw new ValidationError('Statut de contrat invalide.');
  return value as ContractStatus;
}
export function parseContractInput(body: unknown) {
  const input = object(body, ['clientId','reference','title','description','amountCents','currency','status','startDate','endDate','signedAt']);
  function text(key: string, required = false) {
    const v = input[key];
    if (v == null && !required) return null;
    if (typeof v !== 'string' || v.length > 10000 || (required && !v.trim())) throw new ValidationError(`Champ ${key} invalide.`);
    return v.trim() || null;
  }
  function date(key: string) {
    const v = input[key];
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(v)) throw new ValidationError(`Date ${key} invalide.`);
    const d = new Date(v);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v.slice(0,10)) throw new ValidationError(`Date ${key} invalide.`);
    return d;
  }
  if (typeof input.clientId !== 'number') throw new ValidationError('Client invalide.');
  const clientId = parseId(String(input.clientId));
  if (!Number.isInteger(input.amountCents) || (input.amountCents as number) < 0 || (input.amountCents as number) > 2147483647) throw new ValidationError('Montant en centimes invalide.');
  if (input.currency !== undefined && input.currency !== 'EUR') throw new ValidationError('La devise doit être EUR.');
  const reference = text('reference');
  if (reference && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(reference)) throw new ValidationError('Référence invalide (100 caractères maximum).');
  const startDate = date('startDate'), endDate = date('endDate');
  if (startDate && endDate && endDate < startDate) throw new ValidationError('La fin précède le début.');
  return { clientId, reference, title: text('title', true)!, description: text('description'), amountCents: input.amountCents as number, currency: 'EUR', status: parseStatus(input.status === undefined ? 'DRAFT' : input.status), startDate, endDate, signedAt: date('signedAt') };
}
export function parseContractFilters(query: Record<string, unknown>) {
  if (Object.keys(query).some(k => !['clientId','status'].includes(k))) throw new ValidationError('Filtre inconnu.');
  return { ...(query.clientId !== undefined ? { clientId: parseId(query.clientId) } : {}), ...(query.status !== undefined ? { status: parseStatus(query.status) } : {}) };
}
