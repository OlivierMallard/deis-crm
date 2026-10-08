import { clientsRouter, contractsRouter, commercialMetrics } from './routes/commerce.js';
import { actionsRouter } from './routes/actions.js';
import express, { type ErrorRequestHandler } from 'express';
import { Prisma } from './generated/prisma/client.js';
import { prospectsRouter } from './routes/prospects.js';
import { ValidationError } from './validation/prospects.js';

export const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'CRM DEIS API' });
});
app.use('/api/prospects', prospectsRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/contracts', contractsRouter);
app.get('/api/dashboard/commercial', commercialMetrics);
app.use('/api', (_req, res) => { res.status(404).json({ message: 'Route introuvable.' }); });

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ValidationError) {
    res.status(400).json({ message: error.message });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    res.status(404).json({ message: 'Ressource introuvable.' });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
    res.status(409).json({ message: 'Suppression ou relation refusée : des données liées existent.' });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ message: 'Conversion déjà réalisée ou référence déjà utilisée.' });
  } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed') {
    res.status(400).json({ message: 'Le JSON envoyé est invalide.' });
  } else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    res.status(400).json({ message: 'La requête est trop volumineuse.' });
  } else {
    res.status(500).json({ message: 'Une erreur interne est survenue. Veuillez réessayer.' });
  }
};
app.use(errorHandler);
