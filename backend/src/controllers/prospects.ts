import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { parseProspectId, parseProspectInput } from '../validation/prospects.js';

export async function listProspects(_req: Request, res: Response) {
  res.json(await prisma.prospect.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
}

export async function getProspect(req: Request, res: Response) {
  const prospect = await prisma.prospect.findUnique({ where: { id: parseProspectId(req.params.id) } });
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
