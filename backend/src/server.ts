import { app } from './app.js';
const port = 3001;

app.listen(port, () => {
  console.log(`CRM DEIS API démarrée sur http://localhost:${port}`);
});
