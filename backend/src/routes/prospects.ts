import { Router } from 'express';
import { convertProspect, createProspect, deleteProspect, getProspect, listProspects, updateProspect } from '../controllers/prospects.js';

export const prospectsRouter = Router();
prospectsRouter.get('/', listProspects);
prospectsRouter.get('/:id', getProspect);
prospectsRouter.post('/', createProspect);
prospectsRouter.post('/:id/convert', convertProspect);
prospectsRouter.put('/:id', updateProspect);
prospectsRouter.delete('/:id', deleteProspect);
