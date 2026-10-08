# Mission 9 — Recherche, filtres et reporting commercial

## Résultat et compatibilité

La recherche globale, les filtres combinables, la pagination serveur, les exports CSV
et la rubrique Reporting complètent les écrans existants. Les cartes, couleurs,
formulaires, conversions, transitions commerciales, TVA et paiements sont conservés.
Les composants `SearchInput`, `FilterBar`, `Pagination`, `DateRangeFilter` et
`ReferenceSelect` sont partagés. Les recherches ont un debounce de 300 ms.

Aucune modification du schéma Prisma, aucune migration, aucun reset de PostgreSQL,
aucun commit et aucun push. L'objectif est enregistré dans un fichier serveur,
sans nouvelle table. Les tests créent puis suppriment uniquement leurs propres
enregistrements ; les séquences d'identifiants peuvent donc avancer normalement.

**Changement de contrat des listes :** leurs réponses sont désormais des objets
paginés. Les consommateurs React et les tests ont été adaptés. Les routes de détail,
de création, de modification, de suppression, de conversion et de transition
conservent leur contrat. Le paramètre `search` des documents reste accepté comme
alias de `q`. Les tris sans paramètre restent ceux des missions précédentes.

## Routes et pagination

| Route | Fonction |
| --- | --- |
| `GET /api/search?q=...` | Recherche globale regroupée : prospects, clients, contrats, devis, factures |
| `GET /api/prospects` | Prospects filtrés et paginés |
| `GET /api/clients` | Clients filtrés et paginés |
| `GET /api/actions` | Actions filtrées et paginées |
| `GET /api/contracts` | Contrats filtrés et paginés |
| `GET /api/quotes` | Devis filtrés et paginés |
| `GET /api/invoices` | Factures filtrées et paginées, avec règlement calculé |
| `GET /api/payments` | Paiements paginés ; filtres existants `invoiceId`, `clientId` |
| `GET /api/{prospects,clients,actions,contracts,quotes,invoices}/export` | CSV complet des résultats filtrés |
| `GET /api/reports/overview` | Indicateurs de la période |
| `GET /api/reports/monthly` | Agrégations mensuelles et mois sans activité à zéro |
| `GET /api/reports/pipeline` | Répartitions actuelles des prospects et contrats |
| `GET /api/reports/goal` | Objectif et progression du mois contenant `from` |
| `PUT /api/reports/goal` | Enregistrement de l'objectif mensuel récurrent |

Les six listes commerciales acceptent `page` (défaut 1), `pageSize` (défaut 25,
de 1 à 100), `q` ou `search` (200 caractères maximum), `sort`, `direction`
(`asc`, `desc`) et `timeZone` (IANA, défaut UTC pour les appels directs,
Europe/Paris pour les factures afin de conserver la convention financière existante).
Les paramètres inconnus, répétés ou de mauvais type donnent une erreur 400 explicite.
`page` est limité à 1 000 000. Les filtres s'appliquent avant `count`, `skip`, `take`.
Le décompte et les éléments sont lus dans une transaction `RepeatableRead`.

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 25,
  "totalPages": 0
}
```

Une page au-delà des résultats renvoie des éléments vides. React revient à une page
valide après une suppression. Les filtres restent actifs lors de la pagination et
leur modification ramène à la page 1. Le tri possède toujours `id` comme dernier
critère déterministe. Les compteurs du dashboard utilisent `total`, pas la taille
de la page. Les groupes d'actions sont une présentation des éléments de la page
courante ; les filtres et la pagination sont exécutés sur PostgreSQL.

### Recherche globale

`q` est limité à 100 caractères, les résultats à 8 éléments par catégorie.
Les personnes sont recherchées par prénom, nom, société, email et téléphone ;
les documents par référence et titre. La recherche utilise Prisma `contains` avec
`mode: insensitive`. Les requêtes SQL spécifiques utilisent les paramètres Prisma.
Une recherche vide renvoie des catégories vides sans lecture de la base.

Seuls `id`, prénom, nom et société sont retournés pour les personnes ; seuls `id`,
référence et titre pour les documents. Ni notes, ni paiements, ni descriptions,
ni lignes financières ne figurent dans cette réponse. Un clic charge directement
la fiche client, devis ou facture, ou le formulaire du prospect ou contrat, même si
l'élément n'est pas sur la première page de sa rubrique.

## Filtres par rubrique

Les filtres suivants se combinent avec la recherche et la pagination.

| Rubrique | Filtres | Valeurs de `sort` |
| --- | --- | --- |
| Prospects | `status`, `createdFrom`, `createdTo` | `name`, `date`, `updated` |
| Clients | `createdFrom`, `createdTo` | `name`, `date`, `contracts` |
| Actions | `type`, `prospectId`, `completed`, `period` | `due` |
| Contrats | `clientId`, `status`, `startFrom`, `startTo`, `endFrom`, `endTo`, `amountMin`, `amountMax` | `date`, `amount`, `status` |
| Devis | `clientId`, `contractId`, `status`, `dateFrom`, `dateTo`, `amountMin`, `amountMax` | `date`, `amount` |
| Factures | `clientId`, `contractId`, `status`, `paymentStatus`, `overdue`, `dateFrom`, `dateTo`, `dueFrom`, `dueTo`, `amountMin`, `amountMax` | `date`, `due`, `amount` |

La recherche des personnes couvre prénom, nom, société, email et téléphone.
Celle des actions couvre titre et description ; celle des documents, référence
et titre. `name` trie par nom de famille puis identifiant ; `date` utilise la
création pour personnes et contrats, l'émission pour devis et factures.
`contracts` utilise le nombre de contrats liés au client, calculé par PostgreSQL.

Les montants API sont des **centimes HT entiers**, de 0 à 2 147 483 647 ; l'interface
les saisit en euros. Les fourchettes inversées sont refusées. Les dates de début
et de fin des contrats filtrent chacune leur champ, indépendamment.

Statuts :

- Prospects : `NEW`, `CONTACTED`, `QUALIFIED`, `WON`, `LOST`.
- Contrats : `DRAFT`, `PROPOSED`, `SIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`.
- Devis : `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`.
- Factures : `DRAFT`, `ISSUED`, `CANCELLED`.
- Actions : `CALL`, `EMAIL`, `MEETING`, `TASK`, `OTHER`.

`completed` et `overdue` acceptent uniquement `true` ou `false`.
`paymentStatus` accepte `UNPAID`, `PARTIAL` ou `PAID` selon la somme des paiements TTC.
Une facture est en retard si elle est émise, conserve un solde TTC positif et
possède une échéance antérieure au jour local. Les drafts et annulations ne sont
pas en retard. Le filtre de règlement est calculé en SQL avant pagination.

Pour les actions, `period` vaut `overdue` (échéance avant le début du jour),
`today` (pendant le jour local) ou `upcoming` (à partir du lendemain).
Comme dans la mission précédente, ce filtre porte sur l'échéance ; ajouter
`completed=false` pour ne sélectionner que les actions restant à effectuer.

Exemple :

```text
/api/prospects?q=martin&status=QUALIFIED&createdFrom=2026-10-01&createdTo=2026-10-31&timeZone=Europe%2FParis&sort=name&page=2&pageSize=25
/api/invoices?clientId=1&paymentStatus=PARTIAL&overdue=true&amountMin=10000&sort=due
```

Les sélecteurs de relations effectuent une recherche serveur limitée à 25
suggestions et conservent l'élément sélectionné en le chargeant par son identifiant.
Ils permettent donc d'accéder aux clients, prospects et contrats au-delà de la
première page sans charger toute la base dans React.

## Périodes, stockage et calendriers

Les routes Reporting acceptent `from`, `to` au format `YYYY-MM-DD`, et `timeZone`.
La période par défaut va du premier jour du mois local au jour courant. Les bornes
sont inclusives dans l'interface ; les requêtes utilisent `[début, lendemain de fin[`.
Les périodes inversées, les dates inexistantes et les périodes de plus de
1 098 jours sont refusées. Les dates invalides ne sont pas corrigées silencieusement.

Le navigateur transmet son fuseau IANA. Les bornes locales deviennent des instants
UTC pour `createdAt`, `signedAt`, `completedAt`, `dueAt`. Les jours de 23 ou 25 heures
sont respectés. Les anciens champs Prisma `timestamp` sans fuseau représentent
des instants UTC ; l'agrégation mensuelle les interprète ainsi avant de les convertir
dans le fuseau demandé. Les champs `@db.Date` (`issueDate`, `dueDate`, `paidAt`)
représentent des dates civiles : ils ne sont pas décalés lors d'une conversion de
fuseau. Un paiement daté du 1er avril reste rattaché à avril.

Les présélections de 3, 6 et 12 mois incluent le mois courant jusqu'au jour courant.
Une période personnalisée peut inclure des jours futurs. Les graphiques sont des
barres HTML/CSS accessibles avec libellés et valeurs, sans dépendance graphique
supplémentaire. Les cinq séries mensuelles sont affichées séparément ; aucun montant
de contrats, devis, factures ou paiements n'est additionné à une autre série comme
un revenu supplémentaire.

## Définition des indicateurs

La **cohorte** est l'ensemble des prospects dont `createdAt` appartient à la période.
Les montants sont renvoyés en centimes. Les indicateurs d'état restent variables
quand les statuts ou les données sources sont corrigés.

| Champ API | Définition exacte |
| --- | --- |
| `prospectsCreated` | Nombre de prospects de la cohorte |
| `prospectsCurrentlyContacted` | Prospects de la cohorte dont le statut actuel est exactement `CONTACTED` |
| `prospectsCurrentlyQualified` | Prospects de la cohorte dont le statut actuel est exactement `QUALIFIED` |
| `cohortConverted` | Prospects de la cohorte ayant actuellement un client lié par `sourceProspectId`, quelle que soit la date de conversion |
| `conversionRate` | `cohortConverted / prospectsCreated × 100`, ou 0 pour une cohorte vide |
| `clientsCreated` | Clients créés dans la période, y compris les créations directes |
| `contractsSigned` | Contrats avec `signedAt` dans la période et statut actuel `SIGNED`, `IN_PROGRESS` ou `COMPLETED` |
| `signedExclTaxCents` | Somme HT de ces contrats |
| `sentQuotesExclTaxCents` | Somme HT des devis actuellement `SENT`, dont `issueDate` est dans la période |
| `invoicedExclTaxCents` | Somme HT des factures actuellement `ISSUED`, dont `issueDate` est dans la période |
| `receivedInclTaxCents` | Somme TTC des paiements dont `paidAt` est dans la période |
| `actionsCompleted` | Actions dont `completedAt` est dans la période, toujours terminées à la consultation |
| `actionsCurrentlyOverdue` | Actions actuellement non terminées dont l'échéance précède le début du jour local courant, indépendamment de la période sélectionnée |

Les dates de premier contact, de qualification ou d'envoi des devis n'existent pas
dans le modèle. Aucun événement historique n'est inventé. Un prospect qualifié
ne compte pas simultanément comme actuellement contacté. Un statut `WON` seul ne
suffit pas à prouver une conversion : un client lié est nécessaire. Le taux décrit
la conversion actuelle de la cohorte créée sur la période, et non le nombre de
conversions intervenues pendant la période.

Les signatures utilisent exclusivement `signedAt`, déjà disponible. Un contrat
signé sans date est exclu des mesures datées et reste présent dans la répartition
actuelle. `createdAt` n'est jamais utilisé pour inventer une signature. Les devis
acceptés sortent de la mesure des devis actuellement envoyés ; cette mesure n'est
pas un historique exhaustif des envois.

`monthly` retourne, pour chaque mois, `month`, `prospectsCreated`, `clientsCreated`,
`signedExclTaxCents`, `invoicedExclTaxCents`, `receivedInclTaxCents`.
`pipeline` retourne les décomptes actuels par statut et la somme HT des contrats
par statut ; les graphiques affichent les décomptes. Ces répartitions couvrent
toute la base et sont explicitement nommées « situation actuelle ».

## Objectif mensuel persistant

Le fichier `backend/data/reporting-goal.json` est créé avec une valeur initiale de
500 000 centimes, soit 5 000 € HT/mois. Il est ignoré par Git. Le chemin est relatif
au répertoire de lancement du backend ; `REPORTING_GOAL_FILE` permet de fournir
un chemin absolu différent. Le démarrage habituel se fait depuis `backend`.

```json
{ "monthlyExclTaxCents": 500000 }
```

L'interface modifie la valeur par `PUT /api/reports/goal`, avec le même objet JSON.
Le montant doit être un entier de 0 à 2 147 483 647. Les écritures sont sérialisées
dans le processus et utilisent un fichier temporaire puis un renommage atomique.
Le fichier est relu depuis le disque : la configuration survit au redémarrage.
Il doit être conservé et sauvegardé avec la configuration locale du CRM.

`GET` retourne le mois, l'objectif, le facturé HT, le pourcentage d'atteinte et le
reste positif à facturer. Pour un objectif nul, le pourcentage vaut `null` et
l'interface affiche qu'il n'est pas défini. Le pourcentage peut dépasser 100 % ;
la barre visuelle est plafonnée à 100 %. Le reste ne devient jamais négatif.

L'interface affiche toujours **le mois courant**, indépendamment de la période des
graphiques. L'API peut consulter un autre mois via `from`. L'objectif est un montant
mensuel récurrent commun, sans historique de valeurs par mois. Il s'agit de
**facturation HT**, et les paiements TTC ne participent pas à son calcul.

## Export CSV

Les six routes `/export` réutilisent exactement le parseur de filtres et le tri des
listes. `page` et `pageSize` sont validés mais ne limitent pas le contenu exporté.
Tous les résultats correspondants sont inclus jusqu'à 10 000 lignes. Au-delà,
une erreur 400 demande d'affiner les filtres ; aucune troncature silencieuse.

Le format utilise UTF-8 avec BOM, séparateur `;`, fins de ligne CRLF et en-têtes
français. Les champs sont entourés de guillemets, les guillemets internes doublés.
Les montants sont en euros avec virgule décimale. Les valeurs pouvant commencer
une formule (`=`, `+`, `-`, `@`, y compris après espaces ou contrôles) et les valeurs
commençant par tabulation ou retour à la ligne sont préfixées d'une apostrophe.
Les notes privées, descriptions détaillées, lignes des devis et notes de paiement
ne sont pas exportées. Les statuts utilisent leurs codes API.

## Fichiers concernés

Ajouts :

- `backend/src/validation/lists.ts` : validation commune, dates, filtres, tri et pagination.
- `backend/src/routes/discovery.ts` : listes commerciales, recherche globale, CSV.
- `backend/src/routes/reports.ts` : indicateurs, agrégations SQL, pipeline et objectif persistant.
- `backend/tests/reporting.test.mjs` : validation, HTTP, PostgreSQL, CSV et objectif isolé.
- `backend/tests/reporting-ui.test.mjs` : rendu React des écrans et composants partagés.
- `frontend/src/components/ListTools.tsx` : composants communs, pagination et sélecteurs de relations.
- `frontend/src/components/GlobalSearch.tsx` : recherche globale et navigation vers l'élément.
- `frontend/src/components/Reporting.tsx` : indicateurs, graphiques, périodes et objectif.
- `REPORTING.md` : ce document.

Adaptations :

- `backend/src/app.ts` : branchement des nouvelles routes avant les routes de détail.
- Contrôleurs et routes prospects/actions/commerce/finance : retrait des anciennes
  listes non paginées ; pagination des paiements. Le CRUD et les règles financières sont conservés.
- Tests existants prospects/actions/commerce/finance : adaptation des réponses paginées et doubles Prisma.
- `frontend/src/api/prospects.ts`, `frontend/src/api/actions.ts` : réponses paginées et suggestions bornées.
- `frontend/src/App.tsx` : Reporting, recherche globale et ouverture directe des fiches.
- Écrans `Prospects`, `Clients`, `Actions`, `Contracts`, `Finance` : filtres, pagination et export serveur.
- `frontend/src/components/ActionMetrics.tsx` : compteurs fondés sur `total`.
- `frontend/src/styles.css` : styles responsives des filtres, recherche et graphiques.
- `.gitignore` : exclusion de la configuration persistante locale.

## Vérifications automatisées

Validation réalisée le 8 octobre 2026 sur PostgreSQL 17 local sous Docker :

| Vérification | Résultat |
| --- | --- |
| Build backend, génération Prisma et TypeScript | Réussi |
| Build frontend, TypeScript et Vite | Réussi |
| Suite complète avec `TEST_DATABASE=1` | 23 tests réussis, aucun échec, aucun test ignoré |
| Rendu React des six rubriques, filtres, pagination et navigation Reporting | Réussi |
| Recherche insensible à la casse et projections sans notes confidentielles | Réussi |
| Filtres combinés, dates, bornes DST 23/25 h et fuseaux extrêmes | Réussi |
| Pagination, tri stable en cas d'égalité, pages vides | Réussi |
| KPIs, conversion de cohorte, signatures datées, agrégations mensuelles | Réussi |
| Export de toutes les pages, BOM, formules CSV et refus au-delà de 10 000 lignes | Réussi |
| Objectif isolé, validation, écriture persistante, progression et objectif nul | Réussi |
| Tests précédents CRUD, conversions, TVA, verrouillage et paiements concurrents | Réussi |
| Audit SHA-256 avant/après des lignes et colonnes des huit tables métier | Identique |

L'audit compte avant et après : 1 prospect, 0 action, 2 clients, 1 contrat,
1 devis, 1 ligne de devis, 1 facture et 0 paiement. Les empreintes vérifient
également les contenus, pas uniquement les quantités. Le schéma métier existant
est inchangé. Les tests d'objectif utilisent un fichier temporaire isolé et ne
modifient pas la configuration utilisateur.

Commandes de reproduction, depuis `backend` puis `frontend` :

```powershell
npm.cmd run build
$env:TEST_DATABASE = '1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
```

```powershell
npm.cmd run build
```

## Validation manuelle

1. Démarrer le backend et le frontend avec `npm.cmd run dev` dans leurs répertoires.
2. Rechercher un nom, un email, un téléphone ou une référence en haut de l'interface.
   Vérifier le chargement, l'absence de résultat et l'ouverture du bon élément.
3. Dans chacune des six rubriques, combiner recherche, statut, dates ou montants.
   Changer de page, vérifier la conservation des filtres, puis les réinitialiser.
4. Tester les sélecteurs clients/prospects/contrats avec une recherche spécifique,
   puis créer ou modifier un élément en conservant ses relations.
5. Exporter une recherche comportant plusieurs pages. Ouvrir le CSV dans Excel
   français et vérifier accents, colonnes, montants et présence de toutes les lignes.
6. Dans Reporting, parcourir les périodes proposées et une période personnalisée.
   Vérifier les montants avec les documents sources, les dates de signature, d'émission
   et d'encaissement et les mois vides.
7. Modifier l'objectif, redémarrer le backend et vérifier sa persistance. Comparer
   l'atteinte aux factures émises HT du mois courant.
8. Vérifier les écrans sur une largeur mobile, le clavier et les états d'erreur
   en arrêtant momentanément le backend.
9. Refaire une conversion prospect, un devis mixte TVA et un paiement partiel
   pour confirmer le parcours utilisateur des missions précédentes.

## Limites connues

- Le rendu React est testé automatiquement côté serveur ; les interactions et le
  rendu visuel dans un navigateur réel restent à valider avec la procédure ci-dessus.
- Les états contacté, qualifié et envoyé ne disposent pas d'un journal historique.
  Les indicateurs décrivent donc précisément des états actuels et non des événements datés.
- L'objectif récurrent est un fichier local adapté au backend unique actuel.
  Plusieurs processus écrivains nécessiteraient un stockage partagé avec verrouillage,
  ou une table additive après autorisation de migration.
- Les recherches par sous-chaîne et le filtre de règlement SQL peuvent nécessiter
  des index supplémentaires pour de très gros volumes ; aucun index ni migration
  n'a été ajouté sans autorisation.
- La recherche est insensible à la casse, sans promesse de normalisation des accents
  ou des différents formats de téléphone. Les suggestions sont limitées ; affiner
  la recherche permet d'atteindre un élément précis.
- Les listes d'actions restent regroupées visuellement, mais les compteurs de chaque
  groupe portent sur la page courante. Les compteurs globaux du dashboard restent exacts.
- Modifier un statut, rouvrir une action ou corriger un paiement peut modifier un
  reporting passé : le modèle actuel représente les données courantes, sans journal immuable.
