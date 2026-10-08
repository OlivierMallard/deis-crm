# Actions commerciales et relances

Migration 20261008000000_add_actions appliquee apres autorisation explicite. Verification SQL : tables Prospect et Action presentes, prospect existant conserve avec tous ses champs identiques (empreinte SHA-256 avant/apres). Six tests backend reussis, aucun echec ni test ignore, dont les deux tests PostgreSQL CRUD et persistance. Les donnees temporaires des tests ont ete nettoyees.

## Schema et preservation

`backend/prisma/schema.prisma` ajoute ActionType (CALL, EMAIL, MEETING, TASK, OTHER), Action et Prospect.actions (1-N).
Action : id auto-incremente, prospectId obligatoire, type, title, description nullable, dueAt obligatoire, completedAt nullable, createdAt automatique, updatedAt automatique.
Les quatre dates Action sont des TIMESTAMPTZ(3). Les instants sont echanges en UTC ISO avec Z.
Index sur prospectId et dueAt. La cle etrangere ON DELETE RESTRICT conserve les actions : un prospect ayant des actions ne peut pas etre supprime (409). Ses autres operations CRUD restent disponibles.
La migration `backend/prisma/migrations/20261008000000_add_actions/migration.sql` cree uniquement ces objets. Aucun DROP, aucune modification de lignes Prospect, aucune reinitialisation. Les anciennes migrations sont conservees.

## Fichiers

Crees : migration SQL, backend/src/validation/actions.ts, backend/src/controllers/actions.ts, backend/src/routes/actions.ts, backend/tests/actions.test.mjs, frontend/src/api/actions.ts, frontend/src/components/Actions.tsx, frontend/src/components/ActionMetrics.tsx, ACTIONS.md.
Modifies : backend/prisma/schema.prisma, backend/src/app.ts, frontend/src/App.tsx, frontend/src/components/Prospects.tsx, frontend/src/styles.css.
Le client Prisma local est regenere par le build backend.

## Routes

- GET /api/actions : liste avec prospect associe, triee par dueAt puis id.
- GET /api/actions/:id : detail (404 si absent).
- POST /api/actions : creation (201).
- PUT /api/actions/:id : remplacement des champs metier, sans modifier completedAt.
- DELETE /api/actions/:id : suppression (204).
- PATCH /api/actions/:id/complete : terminer ; une seconde cloture conserve la premiere date.
- PATCH /api/actions/:id/reopen : remettre completedAt a null.

POST et PUT attendent { prospectId: nombre entier positif, type: enum, title: texte, description: texte ou null (facultatif), dueAt: date ISO UTC avec Z }.
Les champs inconnus, titres vides, dates impossibles et identifiants invalides sont rejetes (400). Prospect absent : 404 ; conflit relationnel : 409.

Filtres combinables GET : prospectId, completed=true|false, period=overdue|today|upcoming, timeZone=fuseau IANA (ex. Europe/Paris).
Le frontend transmet le fuseau du navigateur. Sans timeZone, le backend utilise UTC. Un fuseau invalide est rejete.
Retard = dueAt strictement avant le debut du jour local ; aujourd'hui = debut inclus, debut du lendemain exclu ; a venir = debut du lendemain inclus.
Le filtre period seul ne filtre pas le statut. L'interface et les indicateurs demandent completed=false ; l'historique demande completed=true sans periode.
Les deux minuits sont calcules separement pour respecter les jours de 23/25 heures.
Les heures locales inexistantes lors du passage a l'heure d'ete sont refusees par le formulaire. Une heure ambigue en automne suit le choix natif JavaScript (premiere occurrence).

## Demarrage sous PowerShell

Depuis la racine : `docker compose up -d postgres` (volume existant conserve).

Seulement apres autorisation explicite, dans backend :

```powershell
npx.cmd prisma migrate status
npx.cmd prisma migrate deploy
```

La commande deploy applique toutes les migrations en attente : verifier le status avant application.

Dans un terminal backend :

```powershell
cd backend
npm.cmd run build
npm.cmd run dev
```

Dans un autre terminal :

```powershell
cd frontend
npm.cmd run dev
```

Backend : http://localhost:3001 ; frontend : adresse affichee par Vite (proxy /api configure).

## Tests et builds

```powershell
cd backend
npm.cmd run build
npm.cmd test
```

Sans TEST_DATABASE, validation, dates/DST et parcours HTTP avec doubles Prisma passent sans toucher PostgreSQL. Les deux tests PostgreSQL sont ignores.
Apres migration autorisee, executer les tests d'integration :

```powershell
$env:TEST_DATABASE = '1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
```

Ces tests ajoutent leurs propres prospects/actions temporaires et suppriment uniquement leurs enregistrements en fin de test. Ils verifient CRUD, transitions, filtres et relecture apres deconnexion du pool PostgreSQL.

Build frontend : `cd frontend` puis `npm.cmd run build`.

## Utilisation

Dans Taches, Ajouter une action, choisir le prospect, le type, le titre, la description et la date/heure locale, puis Enregistrer.
Dans Prospects, Actions commerciales ouvre le suivi du prospect avec ses prochaines actions et son historique ; Ajouter une action pour ce prospect fixe automatiquement son association.
Marquer comme terminee deplace l'action dans l'historique. Rouvrir la remet dans sa periode. Modifier permet d'ajuster les champs. Supprimer demande confirmation.
Le Dashboard affiche les trois compteurs des actions non terminees depuis les donnees de l'API/PostgreSQL. Compteurs et listes sont rafraichis toutes les minutes et au retour dans leur rubrique.

## Verification de persistance

Creer une action, noter son id, redemarrer le backend, puis relire GET /api/actions/:id : l'action doit toujours etre presente.
Lecture SQL sans modification depuis la racine :

```powershell
docker compose exec postgres psql -U crm_user -d crm_deis -c 'SELECT id, "prospectId", title, "dueAt", "completedAt" FROM "Action" ORDER BY id;'
```

Comparer aussi les prospects avant et apres migration avec SELECT COUNT(*) FROM "Prospect" et les identifiants existants.

## Limites

Les tests PostgreSQL et la verification de persistance ont reussi apres application autorisee de la migration. Le fonctionnement visuel n'a pas ete verifie dans un navigateur.
Les compteurs chargent les listes filtrees : aucune pagination ni endpoint COUNT dedie pour cette premiere version.
Aucune authentification, aucun contrat/client et aucune automatisation n8n ajoutes. Aucun commit ni push.
