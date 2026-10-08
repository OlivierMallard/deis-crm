# Gestion des prospects

## Démarrage local (PowerShell)

La migration initiale est déjà appliquée. Ces commandes ne changent pas le schéma.
Docker Desktop doit être ouvert et `backend/.env` doit contenir `DATABASE_URL`.

Depuis la racine :

```powershell
Set-Location F:\DEV\CRM-Deis
docker compose up -d postgres
```

Dans un deuxième terminal :

```powershell
Set-Location F:\DEV\CRM-Deis\backend
npm.cmd run dev
```

Dans un troisième terminal :

```powershell
Set-Location F:\DEV\CRM-Deis\frontend
npm.cmd run dev
```

Ouvrir http://localhost:5173 (ou le port indiqué par Vite). L’API écoute sur
http://localhost:3001 ; le navigateur utilise `/api` grâce au proxy Vite.
Les dépendances existantes suffisent. Sur un nouveau clone, exécuter `npm.cmd ci`
dans chaque application et `npm.cmd run prisma:generate` dans `backend`.

## Parcours des données

La rubrique Prospects charge `GET /api/prospects`. Le formulaire envoie les champs
avec `fetch` en JSON vers `POST` ou `PUT`. Le proxy Vite transmet la requête à
Express, les routes appellent les contrôleurs, la validation normalise les champs
et vérifie prénom, nom, email, statut et identifiant. Le client Prisma existant
écrit dans PostgreSQL via son adaptateur `pg`. La réponse JSON contient le prospect
persisté ; React recharge ensuite la liste sans recharger la page.

La liste est triée par date de création décroissante, puis par identifiant
décroissant en cas d’égalité. Le bouton Modifier ouvre tous les champs, dont notes
et statut. Supprimer demande une confirmation explicite avant d’appeler `DELETE`.

## Contrat API

- `GET /api/prospects` : 200, tableau de prospects.
- `GET /api/prospects/:id` : 200, prospect ; 404 s’il n’existe pas.
- `POST /api/prospects` : 201, prospect créé et en-tête `Location`.
- `PUT /api/prospects/:id` : 200, prospect modifié ; 404 s’il n’existe pas.
- `DELETE /api/prospects/:id` : 204 sans corps ; 404 s’il n’existe pas.
- Entrée invalide : 400 ; erreur interne : 500, message générique.

`POST` et `PUT` attendent `firstName` et `lastName` non vides. `company`, `email`,
`phone`, `notes` acceptent texte ou `null`. Les textes sont nettoyés aux extrémités
et les champs facultatifs vides deviennent `null`. `status` accepte `NEW`,
`CONTACTED`, `QUALIFIED`, `WON`, `LOST` et vaut `NEW` lorsqu’il est omis.
`PUT` remplace tous les champs éditables : les champs facultatifs omis sont effacés.
`id`, `createdAt`, `updatedAt` sont gérés par la base et Prisma, jamais par le formulaire.
Les dates sont des chaînes ISO dans l’API. Les propriétés supplémentaires sont ignorées.

## Vérifications automatisées

```powershell
Set-Location F:\DEV\CRM-Deis\frontend
npm.cmd run build
npx.cmd tsc --noEmit
Set-Location F:\DEV\CRM-Deis\backend
npm.cmd run build
npm.cmd run typecheck
npm.cmd test
```

Le test de validation est indépendant de PostgreSQL. Pour activer le test
d’intégration avec la base configurée dans `.env` :

```powershell
$env:TEST_DATABASE = '1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
```

Ce test démarre une API sur un port temporaire, crée son propre prospect, vérifie
le CRUD, les statuts, le tri, les erreurs 400/404 et la persistance après fermeture
du pool Prisma. Il supprime uniquement ce prospect temporaire en fin de test.
Il ne change pas le schéma et ne supprime aucun prospect préexistant.

## Test manuel dans le navigateur

1. Vérifier que Dashboard s’affiche et indique « API connectée ».
2. Ouvrir Prospects et vérifier la liste réelle, ou le message de liste vide.
3. Cliquer sur Nouveau prospect, saisir prénom, nom, société, email, téléphone
   et notes. Enregistrer : vérifier le message de succès et la ligne en haut de liste.
4. Cliquer sur Modifier : vérifier les valeurs et les notes, modifier la société
   et les notes, enregistrer et rouvrir pour vérifier leur conservation.
5. Modifier successivement le statut : Contacté, Qualifié, Gagné, Perdu.
   Vérifier chaque libellé après enregistrement.
6. Garder ce prospect et arrêter les deux serveurs avec Ctrl+C. Depuis la racine,
   exécuter `docker compose stop postgres`, puis `docker compose up -d postgres`.
   Relancer les deux serveurs avec les commandes ci-dessus. Vérifier que les champs,
   les notes et le statut du prospect sont conservés.
7. Cliquer sur Supprimer puis annuler : la ligne reste. Recommencer et confirmer :
   la ligne disparaît avec un message de succès. Actualiser pour vérifier la suppression.
8. Vérifier qu’un prénom/nom vide ou un email mal formé empêche l’enregistrement.
   Arrêter le backend, retourner dans Prospects : vérifier l’erreur API. Relancer
   le backend et cliquer sur Réessayer.

Le redémarrage complet et les interactions visuelles sont couverts par ce parcours
manuel ; le test automatisé de persistance reconnecte Prisma sans redémarrer Docker.
L’état de santé du Dashboard contrôle l’API, pas la disponibilité de PostgreSQL.
