import express from 'express';

const app = express();
const port = 3001;

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'CRM DEIS API',
  });
});

app.listen(port, () => {
  console.log(`CRM DEIS API démarrée sur http://localhost:${port}`);
});
