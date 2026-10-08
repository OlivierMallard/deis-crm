import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { parseId, parseClientInput, parseContractInput } from '../validation/commerce.js';
export const clientsRouter = Router();
export const contractsRouter = Router();
const clientInclude = { _count: { select: { contracts: true } } };
const contractInclude = { client: { select: { id: true, firstName: true, lastName: true, company: true } } };
clientsRouter.get('/:id', async (req, res) => {
  const row = await prisma.client.findUnique({ where: { id: parseId(req.params.id) }, include: { ...clientInclude, sourceProspect: true, contracts: { orderBy: { id: 'desc' } } } });
  if (!row) { res.status(404).json({ message: 'Client introuvable.' }); return; } res.json(row);
});
clientsRouter.post('/', async (req, res) => { const row = await prisma.client.create({ data: parseClientInput(req.body), include: clientInclude }); res.status(201).location(`/api/clients/${row.id}`).json(row); });
clientsRouter.put('/:id', async (req, res) => { res.json(await prisma.client.update({ where: { id: parseId(req.params.id) }, data: parseClientInput(req.body), include: clientInclude })); });
clientsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const row = await prisma.client.findUnique({ where: { id }, include: clientInclude });
  if (!row) { res.status(404).json({ message: 'Client introuvable.' }); return; }
  if (row.sourceProspectId || row._count.contracts) { res.status(409).json({ message: 'Suppression refusée : ce client possède un historique ou des contrats.' }); return; }
  await prisma.client.delete({ where: { id } }); res.status(204).end();
});
contractsRouter.get('/:id', async (req, res) => {
  const row = await prisma.contract.findUnique({ where: { id: parseId(req.params.id) }, include: contractInclude });
  if (!row) { res.status(404).json({ message: 'Contrat introuvable.' }); return; } res.json(row);
});
async function saveContract(req: import('express').Request, res: import('express').Response) {
  const id = req.method === 'PUT' ? parseId(req.params.id) : undefined;
  const input = parseContractInput(req.body);
  if (!await prisma.client.findUnique({ where: { id: input.clientId } })) { res.status(404).json({ message: 'Client introuvable.' }); return; }
  const previous = id === undefined ? null : await prisma.contract.findUnique({ where: { id } });
  if (id !== undefined && !previous) { res.status(404).json({ message: 'Contrat introuvable.' }); return; }
  const signed = ['SIGNED','IN_PROGRESS','COMPLETED'].includes(input.status);
  const data = { ...input, reference: input.reference ?? previous?.reference ?? `DEIS-${randomUUID()}`, signedAt: input.signedAt ?? previous?.signedAt ?? (signed ? new Date() : null) };
  const row = id === undefined ? await prisma.contract.create({ data, include: contractInclude }) : await prisma.contract.update({ where: { id }, data, include: contractInclude });
  if (id === undefined) res.status(201).location(`/api/contracts/${row.id}`); res.json(row);
}
contractsRouter.post('/', saveContract); contractsRouter.put('/:id', saveContract);
contractsRouter.delete('/:id', async (req, res) => { await prisma.contract.delete({ where: { id: parseId(req.params.id) } }); res.status(204).end(); });
export async function commercialMetrics(_req: import('express').Request, res: import('express').Response) {
  const [totalClients, activeContracts, signed, proposed] = await prisma.$transaction([
    prisma.client.count(), prisma.contract.count({ where: { status: { in: ['SIGNED','IN_PROGRESS'] } } }),
    prisma.contract.aggregate({ where: { status: { in: ['SIGNED','IN_PROGRESS','COMPLETED'] } }, _sum: { amountCents: true } }),
    prisma.contract.aggregate({ where: { status: 'PROPOSED' }, _sum: { amountCents: true } }),
  ], { isolationLevel: 'RepeatableRead' });
  res.json({ totalClients, activeContracts, signedAmountCents: signed._sum.amountCents ?? 0, proposedAmountCents: proposed._sum.amountCents ?? 0 });
}
