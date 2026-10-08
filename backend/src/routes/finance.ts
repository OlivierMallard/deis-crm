import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { Prisma } from '../generated/prisma/client.js';
import { parseId } from '../validation/commerce.js';
import { ValidationError } from '../validation/prospects.js';
import { integer } from '../validation/lists.js';
import { quoteInput, invoiceInput, paymentInput, settlement, object } from '../validation/finance.js';
export class FinanceError extends Error { constructor(public code: number, message: string) { super(message); } }
type Tx = Prisma.TransactionClient;
export const quotesRouter = Router(), invoicesRouter = Router(), paymentsRouter = Router();
const quoteInclude = { client: true, lines: { orderBy: { position: 'asc' as const } } };
const invoiceInclude = { client: true, payments: { orderBy: [{ paidAt: 'desc' as const },{ id: 'desc' as const }] } };
function invoiceView(row: Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>) { return { ...row, ...settlement(row) }; }
async function links(tx: Tx, data: { clientId: number; contractId: number | null }) {
  if (!await tx.client.findUnique({ where: { id: data.clientId } })) throw new FinanceError(404,'Client introuvable.');
  if (data.contractId !== null) {
    const c = await tx.contract.findUnique({ where: { id: data.contractId } });
    if (!c || c.clientId !== data.clientId) throw new ValidationError('Le contrat doit appartenir au client sÃ©lectionnÃ©.');
  }
}
async function lock(tx: Tx, table: 'Quote' | 'Invoice', id: number) {
  const rows = table === 'Quote' ? await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE` : await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${id} FOR UPDATE`;
  if (!(rows as unknown[]).length) throw new FinanceError(404,'Document introuvable.');
}
quotesRouter.get('/:id', async (req,res) => {
  const row = await prisma.quote.findUnique({ where: { id: parseId(req.params.id) }, include: quoteInclude });
  if (!row) throw new FinanceError(404,'Devis introuvable.'); res.json(row);
});
for (const method of ['post','put'] as const) quotesRouter[method](method === 'post' ? '/' : '/:id', async (req,res) => {
  const id = method === 'put' ? parseId((req.params as { id: string }).id) : undefined, input = quoteInput(req.body);
  const row = await prisma.$transaction(async tx => {
    if (id !== undefined) await lock(tx,'Quote',id);
    const previous = id === undefined ? null : await tx.quote.findUniqueOrThrow({ where: { id } });
    if (previous?.status === 'ACCEPTED') throw new FinanceError(409,'Devis acceptÃ© verrouillÃ© : crÃ©er un nouveau devis de rÃ©vision avec une nouvelle rÃ©fÃ©rence.');
    await links(tx,input);
    const { lines, ...fields } = input;
    const data = { ...fields, reference: input.reference ?? previous?.reference ?? `DEV-${randomUUID()}` };
    return id === undefined ? tx.quote.create({ data: { ...data, lines: { create: lines } }, include: quoteInclude }) : tx.quote.update({ where: { id }, data: { ...data, lines: { deleteMany: {}, create: lines } }, include: quoteInclude });
  });
  res.status(method === 'post' ? 201 : 200).json(row);
});
quotesRouter.delete('/:id', async (req,res) => {
  const id = parseId(req.params.id);
  await prisma.$transaction(async tx => { await lock(tx,'Quote',id); const row = await tx.quote.findUniqueOrThrow({ where: { id } }); if (row.status === 'ACCEPTED') throw new FinanceError(409,'Devis acceptÃ© verrouillÃ©.'); await tx.quote.delete({ where: { id } }); });
  res.status(204).end();
});
invoicesRouter.get('/:id', async (req,res) => {
  const row = await prisma.invoice.findUnique({ where: { id: parseId(req.params.id) }, include: invoiceInclude });
  if (!row) throw new FinanceError(404,'Facture introuvable.'); res.json(invoiceView(row));
});
for (const method of ['post','put'] as const) invoicesRouter[method](method === 'post' ? '/' : '/:id', async (req,res) => {
  const id = method === 'put' ? parseId((req.params as { id: string }).id) : undefined, input = invoiceInput(req.body);
  const row = await prisma.$transaction(async tx => {
    if (id !== undefined) await lock(tx,'Invoice',id);
    const previous = id === undefined ? null : await tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    const data = { ...input, reference: input.reference ?? previous?.reference ?? `FAC-${randomUUID()}` };
    if (previous && previous.status !== 'DRAFT') {
      for (const key of Object.keys(data) as (keyof typeof data)[]) {
        if (key === 'status') continue;
        const a = data[key], b = previous[key];
        if ((a instanceof Date ? a.toISOString() : a) !== (b instanceof Date ? b.toISOString() : b)) throw new FinanceError(409,'Facture Ã©mise ou annulÃ©e verrouillÃ©e.');
      }
      if (data.status !== previous.status && !(previous.status === 'ISSUED' && data.status === 'CANCELLED' && !previous.payments.length)) throw new FinanceError(409,'Transition refusÃ©e : annulation uniquement sans paiement.');
    }
    await links(tx,input);
    return id === undefined ? tx.invoice.create({ data, include: invoiceInclude }) : tx.invoice.update({ where: { id }, data, include: invoiceInclude });
  }); res.status(method === 'post' ? 201 : 200).json(invoiceView(row));
});
invoicesRouter.delete('/:id', async (req,res) => {
  const id = parseId(req.params.id);
  await prisma.$transaction(async tx => { await lock(tx,'Invoice',id); const row = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { payments: true } }); if (row.status !== 'DRAFT' || row.payments.length) throw new FinanceError(409,'Seule une facture brouillon sans paiement peut Ãªtre supprimÃ©e.'); await tx.invoice.delete({ where: { id } }); }); res.status(204).end();
});
paymentsRouter.get('/', async (req,res) => {
  const v = object(req.query,['invoiceId','clientId','page','pageSize']);
  const page=v.page===undefined?1:integer(v.page,'page',1,1000000),pageSize=v.pageSize===undefined?25:integer(v.pageSize,'pageSize',1,100);
  const where={ ...(v.invoiceId !== undefined ? { invoiceId: parseId(v.invoiceId) } : {}), ...(v.clientId !== undefined ? { invoice: { clientId: parseId(v.clientId) } } : {}) };
  const result=await prisma.$transaction(async tx=>{const total=await tx.payment.count({where});const items=await tx.payment.findMany({where,include:{invoice:true},orderBy:[{paidAt:'desc'},{id:'desc'}],skip:(page-1)*pageSize,take:pageSize});return {items,total,page,pageSize,totalPages:Math.ceil(total/pageSize)}},{isolationLevel:'RepeatableRead'});
  res.json(result);
});
for (const method of ['post','put'] as const) paymentsRouter[method](method === 'post' ? '/' : '/:id', async (req,res) => {
  const id = method === 'put' ? parseId((req.params as { id: string }).id) : undefined, data = paymentInput(req.body);
  const row = await prisma.$transaction(async tx => {
    await lock(tx,'Invoice',data.invoiceId);
    if (id !== undefined) { const previous = await tx.payment.findUnique({ where: { id } }); if (!previous) throw new FinanceError(404,'Paiement introuvable.'); if (previous.invoiceId !== data.invoiceId) throw new FinanceError(409,'La facture du paiement ne peut pas Ãªtre changÃ©e.'); }
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: data.invoiceId }, include: { payments: true } });
    if (invoice.status !== 'ISSUED') throw new FinanceError(409,'Paiement autorisÃ© uniquement sur une facture Ã©mise.');
    const paid = invoice.payments.filter(p => p.id !== id).reduce((s,p) => s+p.amountCents,0);
    if (paid + data.amountCents > invoice.totalInclTaxCents) throw new FinanceError(409,'Paiement supÃ©rieur au solde restant TTC.');
    return id === undefined ? tx.payment.create({ data }) : tx.payment.update({ where: { id }, data });
  }); res.status(method === 'post' ? 201 : 200).json(row);
});
paymentsRouter.delete('/:id', async (req,res) => {
  const id = parseId(req.params.id);
  await prisma.$transaction(async tx => { const p = await tx.payment.findUnique({ where: { id } }); if (!p) throw new FinanceError(404,'Paiement introuvable.'); await lock(tx,'Invoice',p.invoiceId); await tx.payment.delete({ where: { id } }); }); res.status(204).end();
});
export async function financeMetrics(_req: import('express').Request, res: import('express').Response) {
  const result = await prisma.$transaction(async tx => {
    const quotes = await tx.quote.aggregate({ where: { status: 'SENT' }, _sum: { totalExclTaxCents: true } });
    const contracts = await tx.contract.aggregate({ where: { status: { in: ['SIGNED','IN_PROGRESS','COMPLETED'] } }, _sum: { amountCents: true } });
    const invoices = await tx.invoice.findMany({ where: { status: 'ISSUED' }, include: { payments: true } });
    return { proposedExclTaxCents: quotes._sum.totalExclTaxCents ?? 0, contractedExclTaxCents: contracts._sum.amountCents ?? 0, invoicedExclTaxCents: invoices.reduce((s,i) => s+i.totalExclTaxCents,0), receivedInclTaxCents: invoices.reduce((s,i) => s+settlement(i).paidCents,0), remainingInclTaxCents: invoices.reduce((s,i) => s+settlement(i).remainingCents,0), overdueInvoices: invoices.filter(i => settlement(i).overdue).length };
  }, { isolationLevel: 'RepeatableRead' }); res.json(result);
}

