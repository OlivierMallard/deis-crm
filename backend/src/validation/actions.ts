import { ActionType } from '../generated/prisma/enums.js';
import { ValidationError, parseProspectId } from './prospects.js';
import type { Prisma } from '../generated/prisma/client.js';

export function parseActionId(value: unknown) {
  try { return parseProspectId(value); } catch { throw new ValidationError('Identifiant d’action invalide.'); }
}
export function parseActionInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Un objet JSON est attendu.');
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(k => !['prospectId', 'type', 'title', 'description', 'dueAt'].includes(k))) throw new ValidationError('Champ inconnu ou non modifiable.');
  if (typeof b.prospectId !== 'number') throw new ValidationError('prospectId doit être un entier.');
  const prospectId = parseProspectId(String(b.prospectId));
  if (typeof b.type !== 'string' || !Object.values(ActionType).includes(b.type as ActionType)) throw new ValidationError('Type d’action invalide.');
  if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 500) throw new ValidationError('Titre obligatoire (500 caractères maximum).');
  if (b.description != null && (typeof b.description !== 'string' || b.description.length > 10000)) throw new ValidationError('Description invalide (10000 caractères maximum).');
  if (typeof b.dueAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(b.dueAt)) throw new ValidationError('dueAt doit être une date ISO en UTC (Z).');
  const dueAt = new Date(b.dueAt);
  if (!Number.isFinite(dueAt.getTime()) || dueAt.toISOString().slice(0,19) !== b.dueAt.slice(0,19)) throw new ValidationError('Date invalide.');
  return { prospectId, type: b.type as ActionType, title: b.title.trim(), description: typeof b.description === 'string' ? b.description.trim() || null : null, dueAt };
}

export function dayBounds(timeZone: string, now = new Date()) {
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { throw new ValidationError('Fuseau horaire IANA invalide.'); }
  const parts = (d: Date) => Object.fromEntries(format.formatToParts(d).map(p => [p.type, p.value]));
  const p = parts(now);
  const local = Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day));
  const midnight = (target: number) => {
    let guess = target;
    for (let i=0; i<6; i++) {
      const x = parts(new Date(guess));
      const rendered = Date.UTC(Number(x.year), Number(x.month)-1, Number(x.day), Number(x.hour), Number(x.minute), Number(x.second));
      const next = guess + target - rendered;
      if (next === guess) return new Date(guess);
      guess = next;
    }
    throw new ValidationError('Limite du jour non représentable dans ce fuseau.');
  };
  return { start: midnight(local), end: midnight(local + 86400000) };
}
export function parseActionFilters(query: Record<string, unknown>, now = new Date()): Prisma.ActionWhereInput {
  if (Object.keys(query).some(k => !['prospectId','completed','period','timeZone'].includes(k))) throw new ValidationError('Filtre inconnu.');
  const where: Prisma.ActionWhereInput = {};
  if (query.prospectId !== undefined) where.prospectId = parseProspectId(query.prospectId);
  if (query.completed !== undefined) {
    if (query.completed !== 'true' && query.completed !== 'false') throw new ValidationError('completed doit être true ou false.');
    where.completedAt = query.completed === 'true' ? { not: null } : null;
  }
  const zone = query.timeZone ?? 'UTC';
  if (typeof zone !== 'string') throw new ValidationError('Fuseau invalide.');
  const { start, end } = dayBounds(zone, now);
  if (query.period !== undefined) {
    if (!['overdue','today','upcoming'].includes(query.period as string)) throw new ValidationError('Période invalide.');
    where.dueAt = query.period === 'overdue' ? { lt: start } : query.period === 'today' ? { gte: start, lt: end } : { gte: end };
  }
  return where;
}
