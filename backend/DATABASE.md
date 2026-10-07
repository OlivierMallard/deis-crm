# PostgreSQL et Prisma en développement

Docker exécute uniquement PostgreSQL 17. Le frontend et le backend continuent
à démarrer localement avec `npm run dev`.

## Configuration

- `../docker-compose.yml` définit PostgreSQL, le port local 5432, le contrôle
  de santé et le volume nommé `postgres_data` pour conserver les données.
- PostgreSQL stocke durablement les données du CRM dans la base `crm_deis`.
- Prisma fournit les migrations et un client TypeScript typé pour interroger
  PostgreSQL depuis le backend.
- `prisma/schema.prisma` définit le provider PostgreSQL, le générateur du client,
  le modèle `Prospect` et l'enum `ProspectStatus`.
- `prisma.config.ts` charge `.env`, fournit l'URL à la CLI Prisma et fixe les
  chemins du schéma et des migrations (configuration Prisma 7).
- `.env` contient `DATABASE_URL`, l'adresse de connexion : utilisateur,
  mot de passe, hôte, port, base et schéma PostgreSQL. Ce fichier reste local.
- `.env.example` fournit des identifiants fictifs de développement correspondant
  au Compose local. Aucun secret de production n'y figure.
- `src/lib/prisma.ts` exporte une instance partagée de Prisma Client, avec
  l'adaptateur PostgreSQL et le chargement de `.env`. Les futures routes pourront
  importer `prisma` depuis ce module. La route de santé existante reste inchangée.
- `src/generated/prisma/` contient le client généré, ignoré par Git et
  recréé avec `npm run prisma:generate` ou `npm run build`.

L'identifiant est un entier auto-incrémenté. Prénom et nom sont obligatoires.
Entreprise, email, téléphone et notes sont facultatifs. Le statut initial est
`NEW`; les autres statuts sont `CONTACTED`, `QUALIFIED`, `WON`, `LOST`.
`createdAt` est renseigné à la création; `updatedAt` est géré par Prisma
lors des écritures effectuées via Prisma Client.

## Commandes PowerShell à exécuter

Utiliser `npm.cmd` et `npx.cmd` évite le blocage des scripts PowerShell npm
sur les machines dont la politique d'exécution interdit `npm.ps1`.

### 1. Démarrer PostgreSQL

Ouvrir Docker Desktop, puis depuis la racine du dépôt :

```powershell
docker compose up -d postgres
docker compose ps
docker compose logs --tail 50 postgres
docker compose exec postgres pg_isready -U crm_user -d crm_deis
docker compose exec postgres psql -U crm_user -d crm_deis -c 'SELECT current_database(), current_user, version();'
```

Le premier démarrage initialise réellement la base et l'utilisateur dans le
volume. Attendre le statut `healthy` et le message `accepting connections`.
La requête SQL doit afficher `crm_deis` et `crm_user`.
Les identifiants Compose ne sont appliqués que lors de l'initialisation d'un
volume vide. Le mot de passe local est `crm_dev_password`.

### 2. Vérifier la configuration et générer le client

Depuis la racine du dépôt :

```powershell
Set-Location backend
# Sur un nouveau clone uniquement, si .env n'existe pas :
# Copy-Item .env.example .env
npm.cmd ci
npm.cmd run prisma:validate
npm.cmd run prisma:generate
npm.cmd run typecheck
```

Ces vérifications et la génération du client ne créent aucune table et
ne modifient pas la base.

### 3. Créer et appliquer la première migration

**Cette commande modifie la base.** Depuis `backend` :

```powershell
npx.cmd prisma migrate dev --name init_prospect
npm.cmd run prisma:generate
npx.cmd prisma migrate status
```

`migrate dev` crée un dossier daté dans `backend/prisma/migrations/`, écrit le
SQL de migration, puis crée la table `Prospect`, l'enum `ProspectStatus` et la
table de suivi `_prisma_migrations` dans PostgreSQL. Prisma utilise aussi une
base temporaire de contrôle des migrations (shadow database). L'utilisateur
créé par l'image officielle PostgreSQL dispose des droits nécessaires en local.
Prisma 7 nécessite une génération explicite du client après la migration.
Les futurs fichiers de migration devront être versionnés avec le schéma.
Si Prisma propose une réinitialisation inattendue, interrompre la commande
et examiner les données existantes avant de poursuivre.

### 4. Vérifier la table et la connexion Prisma

Depuis `backend`, revenir à la racine pour les commandes Docker :

```powershell
Set-Location ..
docker compose exec postgres psql -U crm_user -d crm_deis -c '\dt'
docker compose exec postgres psql -U crm_user -d crm_deis -c '\d public.*'
'SELECT COUNT(*) FROM "Prospect";' | docker compose exec -T postgres psql -U crm_user -d crm_deis
Set-Location backend
npm.cmd run build
'import { prisma } from "./dist/lib/prisma.js"; try { console.log("Prospects:", await prisma.prospect.count()); } finally { await prisma.$disconnect(); }' | node --input-type=module
```

La liste des tables doit contenir `Prospect`. Sur une base neuve, les deux
comptages affichent `0`. La dernière commande effectue une lecture via le
client Prisma compilé, sans ajouter de prospect.

### 5. Vérifier l'application existante

Dans un terminal, depuis `backend` :

```powershell
npm.cmd run dev
```

Dans un autre terminal, depuis la racine :

```powershell
Set-Location frontend
npm.cmd run dev
```

Puis dans un troisième terminal :

```powershell
Invoke-RestMethod http://localhost:3001/api/health
Invoke-RestMethod http://localhost:5173/api/health
```

Les deux réponses doivent indiquer `status: ok`. La route `/api/health`
vérifie toujours l'API, pas la connexion à PostgreSQL; le comptage Prisma
ci-dessus vérifie cette connexion. Ouvrir aussi http://localhost:5173.

Pour arrêter PostgreSQL depuis la racine tout en conservant les données :

```powershell
docker compose down
```

`docker compose down -v` supprime le volume et ses données : ne pas l'utiliser
pour un arrêt ordinaire.
