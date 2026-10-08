import { Router } from 'express';
import { createProspect, deleteProspect, getProspect, listProspects, updateProspect } from '../controllers/prospects.js';

export const prospectsRouter = Router();
prospectsRouter.get('/', listProspects);
prospectsRouter.get('/:id', getProspect);
prospectsRouter.post('/', createProspect);
prospectsRouter.put('/:id', updateProspect);
prospectsRouter.delete('/:id', deleteProspect);
