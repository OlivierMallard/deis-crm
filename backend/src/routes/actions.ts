import { Router } from 'express';
import { getAction, saveAction, deleteAction, completeAction, reopenAction } from '../controllers/actions.js';
export const actionsRouter = Router();
actionsRouter.get('/:id', getAction);
actionsRouter.post('/', saveAction);
actionsRouter.put('/:id', saveAction);
actionsRouter.delete('/:id', deleteAction);
actionsRouter.patch('/:id/complete', completeAction);
actionsRouter.patch('/:id/reopen', reopenAction);
