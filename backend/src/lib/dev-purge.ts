import { ValidationError } from '../validation/prospects.js';
export function assertDevPurge() {
  if(process.env.NODE_ENV!=='development'||process.env.ALLOW_DEV_PURGE!=='true')throw new ValidationError('Purge interdite : environnement de développement explicitement configuré requis.');
}
