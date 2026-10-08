import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { parseProspectId, parseProspectInput } from '../validation/prospects.js';

export async function listProspects(_req: Request, res: Response) {
  res.json(await prisma.prospect.findMany({ include: { convertedClient: { select: { id: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
}

export async function getProspect(req: Request, res: Response) {
  const prospect = await prisma.prospect.findUnique({ where: { id: parseProspectId(req.params.id) }, include: { convertedClient: { select: { id: true } } } });
  if (!prospect) { res.status(404).json({ message: 'Prospect introuvable.' }); return; }
  res.json(prospect);
}

export async function createProspect(req: Request, res: Response) {
  const prospect = await prisma.prospect.create({ data: parseProspectInput(req.body) });
  res.status(201).location(`/api/prospects/${prospect.id}`).json(prospect);
}

export async function updateProspect(req: Request, res: Response) {
  const id = parseProspectId(req.params.id);
  const data = parseProspectInput(req.body);
  res.json(await prisma.prospect.update({ where: { id }, data }));
}

export async function deleteProspect(req: Request, res: Response) {
  await prisma.prospect.delete({ where: { id: parseProspectId(req.params.id) } });
  res.status(204).end();
}

export async function convertProspect(req: Request, res: Response) {
  const id = parseProspectId(req.params.id);
  const result = await prisma.$transaction(async tx => {
    const prospect = await tx.prospect.findUnique({ where: { id }, include: { convertedClient: true } });
    if (!prospect) return { status: 404, message: 'Prospect introuvable.' };
    if (prospect.convertedClient) return { status: 409, message: 'Ce prospect est déjà converti.' };
    const { firstName, lastName, company, email, phone, notes } = prospect;
    const client = await tx.client.create({ data: { firstName, lastName, company, email, phone, notes, sourceProspectId: id } });
    await tx.prospect.update({ where: { id }, data: { status: 'WON' } });
    return { status: 201, client };
  });
  if (result.client) res.status(201).location(`/api/clients/${result.client.id}`).json(result.client);
  else res.status(result.status).json({ message: result.message });
}
