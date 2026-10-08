import { Prisma } from '../generated/prisma/client.js';
import { ValidationError } from './prospects.js';
import { parseId } from './commerce.js';
export function object(body: unknown, allowed: string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Objet JSON attendu.');
  const v = body as Record<string, unknown>;
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new ValidationError('Champ inconnu ou non modifiable.');
  return v;
}
export function text(v: unknown, required = false): string | null {
  if (v == null && !required) return null;
  if (typeof v !== 'string' || v.length > 10000 || (required && !v.trim())) throw new ValidationError('Texte invalide.');
  return v.trim() || null;
}
export function date(v: unknown, optional = false): Date | null {
  if (optional && (v == null || v === '')) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ValidationError('Date YYYY-MM-DD attendue.');
  const d = new Date(v);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== v) throw new ValidationError('Date invalide.');
  return d;
}
export function cents(v: unknown, positive = false): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < (positive ? 1 : 0) || v > 2147483647) throw new ValidationError('Montant en centimes invalide.');
  return v;
}
export function vat(v: unknown = 0): number {
  if (v !== 0 && v !== 2000) throw new ValidationError('TVA autorisée : 0 % ou 20 %.');
  return v;
}
export function status(v: unknown, values: readonly string[]) {
  if (typeof v !== 'string' || !values.includes(v)) throw new ValidationError('Statut invalide.');
  return v;
}
export const quoteStatuses = ['DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED'] as const;
export const invoiceStatuses = ['DRAFT','ISSUED','CANCELLED'] as const;
export const methods = ['BANK_TRANSFER','CARD','CASH','CHECK','OTHER'] as const;
export function totals(ht: number, rate: number) {
  cents(ht); vat(rate);
  const vatCents = new Prisma.Decimal(ht).mul(rate).div(10000).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return { totalExclTaxCents: ht, vatCents, totalInclTaxCents: cents(ht + vatCents) };
}
export function line(body: unknown, position: number) {
  const v = object(body, ['description','quantity','unitPriceCents','vatRateBasisPoints']);
  if (typeof v.quantity !== 'string' || !/^\d{1,8}(?:\.\d{1,4})?$/.test(v.quantity)) throw new ValidationError('Quantité positive, 4 décimales maximum.');
  const quantity = new Prisma.Decimal(v.quantity);
  if (quantity.lte(0)) throw new ValidationError('Quantité strictement positive attendue.');
  const unitPriceCents = cents(v.unitPriceCents), vatRateBasisPoints = vat(v.vatRateBasisPoints);
  const ht = quantity.mul(unitPriceCents).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return { description: text(v.description, true)!, quantity, unitPriceCents, vatRateBasisPoints, position, ...totals(ht, vatRateBasisPoints) };
}
export function quoteInput(body: unknown) {
  const v = object(body, ['clientId','contractId','reference','title','description','status','issueDate','validUntil','vatExemptionMention','lines']);
  if (!Array.isArray(v.lines) || !v.lines.length || v.lines.length > 200) throw new ValidationError('Entre 1 et 200 lignes attendues.');
  const lines = v.lines.map(line), issueDate = date(v.issueDate)!, validUntil = date(v.validUntil, true);
  if (validUntil && validUntil < issueDate) throw new ValidationError('Validité antérieure à la date du devis.');
  const totalExclTaxCents = cents(lines.reduce((s,l) => s+l.totalExclTaxCents,0)), vatCents = cents(lines.reduce((s,l) => s+l.vatCents,0));
  return { ...common(v), description: text(v.description), status: status(v.status ?? 'DRAFT', quoteStatuses) as typeof quoteStatuses[number], issueDate, validUntil, totalExclTaxCents, vatCents, totalInclTaxCents: cents(totalExclTaxCents+vatCents), lines };
}
function common(v: Record<string, unknown>) {
  if (typeof v.clientId !== 'number' || (v.contractId != null && typeof v.contractId !== 'number')) throw new ValidationError('Client ou contrat invalide.');
  const reference = text(v.reference);
  if (reference && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(reference)) throw new ValidationError('Référence invalide.');
  return { clientId: parseId(String(v.clientId)), contractId: v.contractId == null ? null : parseId(String(v.contractId)), reference, title: text(v.title,true)!, vatExemptionMention: text(v.vatExemptionMention) };
}
export function invoiceInput(body: unknown) {
  const v = object(body, ['clientId','contractId','reference','title','status','issueDate','dueDate','vatExemptionMention','totalExclTaxCents','vatRateBasisPoints','vatCents','totalInclTaxCents']);
  const vatRateBasisPoints = vat(v.vatRateBasisPoints), amounts = totals(cents(v.totalExclTaxCents),vatRateBasisPoints);
  for (const key of ['vatCents','totalInclTaxCents'] as const) if (v[key] !== undefined && cents(v[key]) !== amounts[key]) throw new ValidationError('Montants HT/TVA/TTC incohérents.');
  const issueDate = date(v.issueDate)!, dueDate = date(v.dueDate)!;
  if (dueDate < issueDate) throw new ValidationError('Échéance antérieure à la date de facture.');
  return { ...common(v), ...amounts, vatRateBasisPoints, status: status(v.status ?? 'DRAFT',invoiceStatuses) as typeof invoiceStatuses[number], issueDate, dueDate };
}
export function paymentInput(body: unknown) {
  const v = object(body,['invoiceId','amountCents','paidAt','method','reference','notes']);
  if (typeof v.invoiceId !== 'number') throw new ValidationError('Facture invalide.');
  return { invoiceId: parseId(String(v.invoiceId)), amountCents: cents(v.amountCents,true), paidAt: date(v.paidAt)!, method: status(v.method,methods) as typeof methods[number], reference: text(v.reference), notes: text(v.notes) };
}
export function financeToday() { const parts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const get = (type: string) => parts.find(p => p.type === type)!.value; return `${get('year')}-${get('month')}-${get('day')}`; }
export function settlement(row: { status: string; dueDate: Date; totalInclTaxCents: number; payments: { amountCents: number }[] }, today = financeToday()) {
  const paidCents = row.payments.reduce((s,p) => s+p.amountCents,0), remainingCents = row.totalInclTaxCents-paidCents;
  return { paidCents, remainingCents, paymentStatus: paidCents === 0 ? 'UNPAID' : remainingCents === 0 ? 'PAID' : 'PARTIAL', overdue: row.status === 'ISSUED' && remainingCents > 0 && row.dueDate.toISOString().slice(0,10) < today };
}
