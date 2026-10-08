import { ProspectStatus } from '../generated/prisma/enums.js';

export class ValidationError extends Error {}

export function parseProspectId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new ValidationError('Identifiant de prospect invalide.');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id > 2147483647) {
    throw new ValidationError('Identifiant de prospect invalide.');
  }
  return id;
}

export function parseProspectInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Un objet JSON est attendu.');
  }
  const input = body as Record<string, unknown>;
  function required(key: string, label: string): string {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(`${label} est obligatoire.`);
    }
    return value.trim();
  }
  function optional(key: string): string | null {
    const value = input[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new ValidationError(`Le champ ${key} doit être du texte.`);
    return value.trim() || null;
  }
  const firstName = required('firstName', 'Le prénom');
  const lastName = required('lastName', 'Le nom');
  const email = optional('email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError('Adresse email invalide.');
  }
  const status = input.status === undefined ? ProspectStatus.NEW : input.status;
  if (typeof status !== 'string' || !Object.values(ProspectStatus).includes(status as ProspectStatus)) {
    throw new ValidationError('Statut de prospect invalide.');
  }
  return { firstName, lastName, company: optional('company'), email,
    phone: optional('phone'), notes: optional('notes'), status: status as ProspectStatus };
}
