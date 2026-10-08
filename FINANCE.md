# Devis, factures internes, paiements et TVA — Mission 8

## État de livraison

Développement et validation PostgreSQL terminés le 8 octobre 2026. **Migration appliquée après autorisation explicite.** Aucun commit, push, réinitialisation ou changement de données préexistantes. Le contrôle `prisma migrate status` confirme que le schéma est à jour. Le bilan après migration figure en fin de document.

## Architecture et modèles

Express expose les routes financières dans `backend/src/routes/finance.ts`. La validation et les calculs exacts sont dans `backend/src/validation/finance.ts`. Les pages React réutilisent les classes CSS existantes, sans dépendance supplémentaire.

- Quote : client obligatoire, contrat facultatif, référence unique, titre, description, statut DRAFT/SENT/ACCEPTED/REJECTED/EXPIRED, dates, mention TVA, totaux HT/TVA/TTC persistés et timestamps.
- QuoteLine : devis obligatoire, description, quantité Decimal(12,4), prix HT entier en centimes, taux en points de base, position et montants calculés persistés. Ordre unique par devis.
- Invoice : client obligatoire, contrat facultatif, référence unique, titre, émission/échéance, montants et taux persistés, mention TVA, statut DRAFT/ISSUED/CANCELLED et timestamps.
- Payment : facture obligatoire, montant TTC positif en centimes, date, méthode BANK_TRANSFER/CARD/CASH/CHECK/OTHER, référence, notes et timestamps.

Relations Client/Contract → Quote/Invoice restrictives ; Invoice → Payment restrictive. La suppression d'un devis autorisé supprime ses seules lignes. Index client, contrat, statut, échéance et date de règlement. Aucun contrat n'est créé ou modifié par ce module.

La migration générée par `prisma migrate diff` entre le schéma Git précédent et le nouveau schéma est additive : trois enums, quatre tables, index, clés étrangères et contraintes CHECK sur les nouvelles tables. Inspection : aucun DROP/TRUNCATE/DELETE/UPDATE, aucune modification des tables Prospect/Action/Client/Contract.

## Routes et formats

| Méthodes | Route | Fonction |
| --- | --- | --- |
| GET, POST | `/api/quotes` | Liste et création ; filtres clientId, contractId, status, search |
| GET, PUT, DELETE | `/api/quotes/:id` | Fiche, remplacement du formulaire et des lignes, suppression autorisée |
| GET, POST | `/api/invoices` | Liste et création ; mêmes filtres |
| GET, PUT, DELETE | `/api/invoices/:id` | Fiche avec paiements, modification, suppression du brouillon |
| GET, POST | `/api/payments` | Liste filtrable invoiceId/clientId et règlement |
| PUT, DELETE | `/api/payments/:id` | Correction ou suppression d'un paiement erroné |
| GET | `/api/dashboard/finance` | Six indicateurs financiers réels |

PUT reçoit un formulaire complet. Dates financières : YYYY-MM-DD ; quantités : chaînes décimales positives avec quatre décimales maximum. Montants : entiers de 0 à 2147483647 centimes, paiements strictement positifs. Tous les champs inconnus sont rejetés. Référence facultative : UUID préfixé DEV/FAC à la création, référence conservée si absente à la modification. Doublons refusés. Le contrat doit appartenir au client choisi. Validité/échéance antérieure à l'émission refusée.

Réponses : 400 validation, 404 introuvable, 409 verrouillage/surpaiement/doublon/relation restrictive, 500 erreur interne. Les montants proposés par un appelant ne peuvent pas remplacer les calculs du serveur. Les factures acceptent facultativement vatCents et totalInclTaxCents uniquement s'ils correspondent aux montants recalculés.

## TVA et arrondis

Seuls 0 et 2000 points de base sont permis. **0 % par défaut** pour chaque nouvelle ligne et facture ; 20 % uniquement par sélection explicite. Un devis peut mélanger les taux. Taux et montants sont conservés en PostgreSQL, indépendamment des prochaines saisies.

`vatExemptionMention` est un texte facultatif configurable, vide par défaut. Le CRM n'infère aucun régime fiscal à partir du taux 0 %. Il n'impose aucune mention.

Politique : Decimal, arrondi HALF_UP au centime. Pour chaque ligne : quantité × prix en centimes → HT arrondi ; TVA calculée sur ce HT arrondi → TVA arrondie ; TTC = HT + TVA. Les totaux du devis additionnent les montants arrondis par ligne. Une facture applique cette même politique à son montant HT. Exemple : 1,25 × 0,10 € = 0,13 € HT ; TVA 20 % = 0,03 € ; TTC = 0,16 €. La prévision frontend utilise BigInt ; le serveur reste l'autorité pour les montants enregistrés.

## Verrouillage et règlements

- Devis ACCEPTED : modification et suppression entièrement refusées. Pour réviser, créer explicitement un nouveau devis avec une nouvelle référence ; préciser l'origine dans sa description. Aucun lien de révision automatique ni contrat automatique.
- Facture ISSUED ou CANCELLED : tous les champs autres que le statut sont verrouillés. ISSUED peut seulement passer à CANCELLED, sans aucun paiement. Une facture annulée ne peut pas être réouverte.
- Seul un brouillon sans paiement peut être supprimé. Aucune facture émise n'est supprimable.
- Paiements autorisés uniquement sur ISSUED, dans la limite du solde TTC. Plusieurs paiements et corrections sont possibles. La facture d'un paiement existant ne peut pas changer.
- Chaque création/correction/suppression de règlement et chaque mutation de facture verrouille la même ligne Invoice par `SELECT ... FOR UPDATE` dans une transaction. Après acquisition du verrou, les paiements sont relus et le solde recalculé. Deux requêtes concurrentes ne peuvent consommer le même solde. Le verrou sur Quote protège aussi une acceptation concurrente d'une modification.
- UNPAID/PARTIAL/PAID sont dérivés des règlements, jamais stockés. Une facture de montant nul sans paiement reste UNPAID et n'est pas en retard.
- Retard : facture ISSUED, solde positif et échéance strictement antérieure au jour courant en Europe/Paris. Le jour de l'échéance n'est pas en retard.
- Les corrections sont explicites depuis la fiche ; suppressions avec confirmation dans l'interface. Pas de journal d'audit immuable ni mécanisme de remboursement : l'annulation avec paiements reste interdite.

## Interface et indicateurs

Sidebar : Devis et Factures. Formulaires, références, clients, contrats facultatifs, dates, lignes, taux individuels, mentions, prévisions, consultation, transitions explicites, chargement, succès, erreurs et listes vides. La fiche facture affiche les règlements et permet leur saisie et correction. Les fiches clients intègrent les devis et factures, avec boutons de création et accès aux règlements de chaque facture. Chaque contrat propose un bouton Factures et sa liste filtrée.

Le dashboard financier s'ajoute aux indicateurs existants : devis SENT HT ; contrats SIGNED/IN_PROGRESS/COMPLETED HT ; factures ISSUED HT ; paiements TTC de ces factures ; solde TTC ; nombre de factures en retard. Lecture cohérente en transaction RepeatableRead. Les montants ne sont jamais additionnés entre catégories ; brouillons et factures annulées sont exclus des indicateurs actifs.

## Fichiers créés/modifiés

- Backend : `prisma/schema.prisma`, `prisma/migrations/20261008020000_add_finance/migration.sql`, `src/validation/finance.ts`, `src/routes/finance.ts`, `src/app.ts`, `tests/finance.test.mjs`, `package.json`.
- Frontend : `src/components/Finance.tsx`, `src/components/FinanceMetrics.tsx`, `src/components/Clients.tsx`, `src/components/Contracts.tsx`, `src/App.tsx`, `src/styles.css`.
- Documentation : `FINANCE.md`.
- Audit final : `backend/scripts/finance-audit.mjs`, outil en lecture seule comparant les nombres de lignes et les empreintes SHA-256 des données et colonnes ; il stocke uniquement ces empreintes dans le dossier temporaire système.

Les tests s'exécutent avec `--test-concurrency=1` pour éviter que les suites PostgreSQL existantes modifient les tables pendant la comparaison de conservation des données.

## Lancement et vérification

Backend depuis `backend` :

```powershell
npm.cmd run build
npm.cmd run typecheck
npm.cmd run prisma:validate
npm.cmd test
npm.cmd run dev
```

Frontend depuis `frontend` : `npm.cmd run build`, puis `npm.cmd run dev`.

**Après autorisation explicite uniquement**, depuis `backend` :

```powershell
npx.cmd prisma migrate deploy
npx.cmd prisma migrate status
$env:TEST_DATABASE = '1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
```

La suite PostgreSQL crée des données temporaires et nettoie uniquement leurs identifiants. Elle compare avant/après toutes les lignes préexistantes de Prospect, Action, Client et Contract. Elle vérifie les paiements concurrents réels, la persistance après déconnexion et les routes financières. Les tests ne réinitialisent jamais la base ni ses séquences.

## Résultats avant migration

- Build et TypeScript backend réussis ; validation Prisma réussie.
- Build frontend (TypeScript + Vite) réussi.
- Tests : **15 au total, 11 réussis, 4 différés, 0 échec**.
- Exécutés : calculs exacts, TVA par défaut/sélection/mélange, quantités et arrondis, rejets, dépassement de capacité, statut dérivé, retard, inspection additive de migration, API financière avec doubles Prisma (CRUD, lignes, références, verrouillages, corrections, suppression, indicateurs), non-régression existante avec doubles Prisma.
- Différés : quatre suites PostgreSQL (prospects, actions, commerce, finance). Le test concurrent avec doubles valide le comportement HTTP mais ne prouve pas les verrous PostgreSQL réels.
- Aucune migration appliquée ; aucune vérification visuelle navigateur effectuée.

## Procédure manuelle après migration

1. Créer un client ; ouvrir sa fiche et Nouveau devis. Vérifier le taux 0 % sur chaque nouvelle ligne et l'absence de mention imposée.
2. Saisir 1000 € HT à 0 % et 500 € HT à 20 % : 1500 € HT, 100 € TVA, 1600 € TTC. Changer les taux, supprimer/ajouter une ligne et vérifier les prévisions et les montants retournés après sauvegarde.
3. Tester quantité 1,25 et prix 0,10 €, TVA 20 % : 0,16 € TTC. Recharger et vérifier les taux conservés.
4. Filtrer/rechercher, modifier le devis, l'envoyer, puis l'accepter. Vérifier le verrouillage et l'absence de nouveau contrat.
5. Créer une facture depuis le client ou un contrat ; vérifier le filtre de contrat, TVA 0 % et les échéances. Émettre puis tenter une modification financière.
6. Depuis sa fiche, enregistrer deux paiements partiels, corriger puis supprimer une erreur après confirmation. Vérifier solde, statut et retard ; tenter un surpaiement.
7. Vérifier refus d'annulation avec paiement, puis annulation après correction des règlements et exclusion des indicateurs. Vérifier refus de suppression de facture émise.
8. Vérifier les six indicateurs séparément, et les anciennes pages Prospects, Tâches, Clients et Contrats.

## Limites

Outil interne uniquement : aucun document fiscal officiel, PDF, envoi client, Stripe, signature, authentification ou automatisation. Pas de remboursements, avoirs, numérotation fiscale officielle, export comptable ni journal d'audit immuable. Listes sans pagination comme les écrans existants. Toute qualification fiscale et émission officielle restent hors périmètre.

## Bilan après migration autorisée

- Dernière inspection SQL avant application : uniquement créations de tables/enums/index et ajouts de contraintes sur les nouvelles tables. Aucun ordre destructif ni modification de table préexistante. Les clauses ON DELETE des clés étrangères définissent les protections futures ; elles ne suppriment aucune ligne pendant la migration.
- `prisma migrate deploy` : migration `20261008020000_add_finance` appliquée avec succès. `prisma migrate status` : base à jour.
- Tables confirmées : Prospect, Action, Client, Contract, Quote, QuoteLine, Invoice et Payment.
- Builds frontend et backend, TypeScript backend et frontend, validation Prisma : réussis.
- Suite complète avec TEST_DATABASE=1 : **15 tests réussis, 0 échec, 0 ignoré**. Les quatre suites auparavant différées ont été exécutées sur PostgreSQL.
- Devis persistés et relus à TVA 0 % par défaut : 1000 € HT, 0 € TVA, 1000 € TTC ; à 20 % : 1000 € HT, 200 € TVA, 1200 € TTC ; taux mixtes : 1500 € HT, 100 € TVA, 1600 € TTC. Quantité 1,25 × 0,10 € HT à 20 % : 0,13 € HT, 0,03 € TVA, 0,16 € TTC.
- CRUD, remplacement des lignes, unicité des références, historique des taux après déconnexion, verrouillage des devis acceptés et factures émises : validés.
- Facture 100 € TTC : deux règlements simultanés de 60 € donnent une réponse 201 et une réponse 409. Statut PARTIAL, correction à 50 €, deuxième règlement de 50 €, statut PAID et absence de retard. Un paiement supplémentaire de 0,01 € est refusé. Suppression des règlements erronés, annulation sans paiement et refus des paiements sur brouillon/annulation : validés.
- Les six indicateurs financiers ont été vérifiés par comparaison avant/après les opérations. Facture émise impayée : +100 € HT facturé, +100 € TTC restant, +1 facture en retard ; après paiement complet : +100 € TTC encaissé, solde et compteur de retard revenus au niveau initial. Contrats inchangés ; devis SENT puis ACCEPTED retiré des devis en attente ; facture annulée exclue.
- Audit externe à la suite avant migration, après migration et après nettoyage final : données et colonnes identiques par SHA-256 sur Prospect, Action, Client et Contract.

| Table | Avant migration | Après migration | Après tous les tests |
| --- | ---: | ---: | ---: |
| Prospect | 1 | 1 | 1 |
| Action | 0 | 0 | 0 |
| Client | 2 | 2 | 2 |
| Contract | 1 | 1 | 1 |
| Quote | absente | 0 | 0 |
| QuoteLine | absente | 0 | 0 |
| Invoice | absente | 0 | 0 |
| Payment | absente | 0 | 0 |

Nettoyage limité aux identifiants créés par les tests. Aucune donnée temporaire résiduelle ; les séquences ont naturellement avancé et n'ont pas été réinitialisées. Aucun commit ni push. **Aucune anomalie détectée dans les vérifications exécutées.** L'affichage visuel dans un navigateur n'a pas été testé ; les vérifications fonctionnelles ont été réalisées par API et PostgreSQL.
