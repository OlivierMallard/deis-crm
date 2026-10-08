import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { parseActionId, parseActionInput } from '../validation/actions.js';
const include = { prospect: { select: { id: true, firstName: true, lastName: true, company: true } } };
export async function getAction(req: Request, res: Response) {
  const action = await prisma.action.findUnique({ where: { id: parseActionId(req.params.id) }, include });
  if (!action) { res.status(404).json({ message: 'Action introuvable.' }); return; }
  res.json(action);
}
export async function saveAction(req: Request, res: Response) {
  const id = req.method === 'PUT' ? parseActionId(req.params.id) : undefined;
  const data = parseActionInput(req.body);
  if (!await prisma.prospect.findUnique({ where: { id: data.prospectId } })) { res.status(404).json({ message: 'Prospect introuvable.' }); return; }
  const action = id === undefined ? await prisma.action.create({ data, include }) : await prisma.action.update({ where: { id }, data, include });
  if (id === undefined) res.status(201).location(`/api/actions/${action.id}`);
  res.json(action);
}
export async function deleteAction(req: Request, res: Response) {
  await prisma.action.delete({ where: { id: parseActionId(req.params.id) } });
  res.status(204).end();
}
export async function completeAction(req: Request, res: Response) {
  const id = parseActionId(req.params.id);
  // Mise à jour conditionnelle : terminer deux fois conserve la première date.
  await prisma.action.updateMany({ where: { id, completedAt: null }, data: { completedAt: new Date() } });
  await getAction(req, res);
}
export async function reopenAction(req: Request, res: Response) {
  res.json(await prisma.action.update({ where: { id: parseActionId(req.params.id) }, data: { completedAt: null }, include }));
}
