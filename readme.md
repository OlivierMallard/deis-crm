# CRM DEIS

CRM et dashboard commercial développé avec React, TypeScript, Node.js, PostgreSQL et Docker.

## Objectifs

- Gestion des prospects
- Conversion prospect → client
- Gestion des actions et relances
- Todo / checklist commerciale
- Gestion des contrats
- Dashboard et KPI commerciaux
## Mission 10 — installation et authentification

Prérequis : Node.js 24, Docker et PostgreSQL 17. Dans deux terminaux, installer
les dépendances de `backend` et `frontend` avec `npm.cmd ci`. Copier
`backend/.env.example` vers `backend/.env` et adapter la connexion PostgreSQL.

Avant chaque migration, sauvegarder la base (ne jamais utiliser `migrate reset`
ni `docker compose down -v`) :

```powershell
docker compose up -d postgres
docker compose exec -T postgres pg_dump -U crm_user -d crm_deis -Fc -f /tmp/crm-before.dump
docker compose cp postgres:/tmp/crm-before.dump ./crm-before.dump
cd backend
npx.cmd prisma migrate deploy
npm.cmd run build
npm.cmd run admin:create
```

La commande interactive demande email, nom, mot de passe masqué et confirmation.
Elle refuse de créer un nouvel administrateur si un administrateur actif existe.
Aucun identifiant applicatif n’est fourni par défaut. Le mot de passe doit comporter
12 à 128 caractères. Ensuite lancer `npm.cmd run dev` dans chaque répertoire et
ouvrir l’adresse Vite. La connexion est requise pour toutes les données du CRM.

Dans **Administration**, créer un compte avec le rôle `USER` ou `ADMIN` et
transmettre son accès initial par un canal sécurisé. Le changement de rôle,
la désactivation et la réinitialisation du mot de passe révoquent ses sessions.
La réinitialisation demande un nouveau mot de passe ; aucun secret n’apparaît
dans le journal d’audit. Le dernier administrateur actif ne peut pas être désactivé
ni rétrogradé. Chaque opération sensible demande confirmation.

Les administrateurs peuvent archiver/restaurer les personnes via leur liste.
Le filtre Archives permet de retrouver les fiches archivées. Les suppressions
restent bloquées par les relations existantes. Seuls les devis brouillons sont
supprimables ; aucune facture émise ou annulée n’est supprimable par le CRUD.
La correction d’une facture suit la transition d’annulation existante ; le CRM
ne possède pas encore de module d’avoirs.

### Configuration des sessions

`APP_ORIGIN` doit être l’origine exacte du frontend. En production, définir
`NODE_ENV=production` et servir frontend et `/api` derrière le même domaine HTTPS.
Le cookie `__Host-crm-session` est Secure, HttpOnly, SameSite=Strict et limité à `/`.
En développement HTTP, il se nomme `crm-session`. La session expire après huit
heures. La base ne conserve que le SHA-256 du jeton aléatoire. Le jeton CSRF reste
en mémoire du navigateur ; aucun jeton ni mot de passe n’est écrit dans localStorage.
Les mutations vérifient le jeton CSRF et l’origine lorsqu’elle est fournie.
Les tentatives de connexion sont limitées par IP (10 / 15 minutes, processus unique).
Un déploiement multi-instance nécessitera un magasin partagé pour ce limiteur.

### Exports

Utiliser **Exporter CSV** ou **Excel (.xlsx)** dans les listes. Le module Factures
propose également les règlements des factures filtrées. Tous les résultats filtrés
sont exportés, quelle que soit la page. Réinitialiser les filtres pour tout exporter.
La limite est de 10 000 lignes : au-delà, affiner la période et les filtres ; aucune
troncature silencieuse. Les CSV ont un BOM UTF-8, un séparateur `;` et des montants
avec virgule. Les XLSX contiennent des montants numériques en euros et des dates,
des en-têtes, filtres et volets figés. Les valeurs utilisateur sont des chaînes,
jamais des formules. Les exports sont générés par le backend et audités sans contenu.

Le facturé clients correspond aux factures `ISSUED` HT, le réglé à leurs paiements
TTC et le solde au TTC restant. Les brouillons et annulations sont exclus de ces
totaux ; les exports de factures conservent le statut et les montants du document.
Le solde dû exporté vaut zéro pour les factures brouillons ou annulées.
L’API règlements accepte aussi `paidFrom` et `paidTo` (dates de paiement inclusives).
Les filtres de dates visibles dans Factures portent sur les dates des factures.

`ALLOW_DEV_PURGE=false` par défaut. Aucune purge n’est exécutée à l’installation.
L’API administrative de purge fictive exige `NODE_ENV=development`,
`ALLOW_DEV_PURGE=true`, une facture dont la référence commence par `FICTION-`
et le titre par `[FICTION]`, ainsi qu’une confirmation contenant son identifiant.
Elle refuse toujours la production. Ne pas activer cette option sur une base réelle.

### Validation

```powershell
cd backend
npm.cmd run build
npm.cmd test
# Tests PostgreSQL facultatifs, créent puis nettoient uniquement leurs fixtures :
$env:TEST_DATABASE='1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
cd ../frontend
npm.cmd run build
```

Consulter `REPORTING.md` pour le bilan, les limites et les résultats effectivement
obtenus. Aucun commit ni push n’est réalisé automatiquement.
