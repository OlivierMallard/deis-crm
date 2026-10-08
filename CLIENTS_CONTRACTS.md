# Clients, contrats et conversion des prospects — Mission 7

## État de livraison

Implémentation validée le 8 octobre 2026. **Migration appliquée après autorisation explicite.** Les données préexistantes sont conservées ; aucun commit ni push effectué. Le bilan final figure en fin de document.

## Modèles et relations

- `Client` : identité obligatoire, société/email/téléphone/notes facultatifs, dates de création et modification. `sourceProspectId` facultatif et unique ; lien vers le prospect conservé, contrats en relation 1-N.
- `Contract` : client obligatoire, référence unique, titre, description facultative, montant HT entier en centimes, devise EUR, statut, dates facultatives et date de signature. Index client et statut.
- Statuts : DRAFT (Brouillon), PROPOSED (Proposé), SIGNED (Signé), IN_PROGRESS (En cours), COMPLETED (Terminé), CANCELLED (Annulé).
- Les champs existants de Prospect et Action sont conservés. Seule la relation inverse `convertedClient` est ajoutée au prospect.
- Les clés étrangères utilisent `ON DELETE RESTRICT`. L'API refuse aussi la suppression d'un client provenant d'un prospect, même sans contrat. Les liens d'origine ne sont pas modifiables par le CRUD client.

## Migration inspectée

`backend/prisma/migrations/20261008010000_add_clients_contracts/migration.sql` a été générée par comparaison du schéma précédent et du nouveau schéma, sans base temporaire ni application SQL.

Elle crée uniquement l'enum ContractStatus, Client, Contract, leurs index, leurs clés étrangères restrictives et des contraintes CHECK pour le montant non négatif, l'ordre des dates et EUR. Aucun DROP, aucune suppression, aucune modification des tables Prospect et Action.

Le contrôle en lecture `prisma migrate status` confirme que les deux migrations précédentes sont appliquées et que seule cette nouvelle migration est en attente.

Après autorisation uniquement, depuis `backend` :

```powershell
npx.cmd prisma migrate deploy
npx.cmd prisma migrate status
```

Ne pas utiliser reset, force-reset ou suppression du volume Docker.

## Routes API

| Méthode | Route | Comportement |
| --- | --- | --- |
| POST | `/api/prospects/:id/convert` | Crée le client et passe le prospect à WON dans une transaction ; conserve notes et actions. |
| GET, POST | `/api/clients` | Liste avec nombre de contrats ; création directe. |
| GET, PUT, DELETE | `/api/clients/:id` | Fiche avec prospect et contrats ; modification des coordonnées ; suppression restrictive. |
| GET, POST | `/api/contracts` | Liste filtrable par clientId et status ; création. |
| GET, PUT, DELETE | `/api/contracts/:id` | Consultation, modification et suppression. |
| GET | `/api/dashboard/commercial` | Indicateurs PostgreSQL dans une transaction RepeatableRead. |

Les écritures client et contrat rejettent les champs inconnus. PUT reçoit le formulaire complet. Référence absente ou vide : génération UUID côté serveur à la création, conservation de la référence existante à la modification. EUR est la seule devise acceptée. Montant API : entier entre 0 et 2147483647 centimes. Dates : YYYY-MM-DD ou horodatage UTC ISO avec secondes ; dates impossibles et fin avant début rejetées.

`signedAt` est renseigné à la première entrée dans SIGNED, IN_PROGRESS ou COMPLETED et conservé ensuite. Son maintien sur un contrat annulé ne l'inclut pas dans les indicateurs : ceux-ci se fondent sur le statut actuel.

Erreurs : 400 validation/JSON invalide, 404 ressource absente, 409 conversion ou référence déjà existante/relation restrictive, 500 erreur interne. La contrainte unique sourceProspectId empêche les doublons concurrents ; l'échec de la transaction annule aussi la création du client.

## Indicateurs

- `totalClients` : tous les clients.
- `activeContracts` : SIGNED et IN_PROGRESS uniquement.
- `signedAmountCents` : somme SIGNED, IN_PROGRESS et COMPLETED.
- `proposedAmountCents` : somme PROPOSED, séparée.

Les contrats DRAFT et CANCELLED ne contribuent à aucune somme. Chaque contrat contribue au plus une fois. Ce sont des montants contractuels HT, pas des encaissements. Les indicateurs d'actions et relances existants restent présents.

## Fichiers ajoutés ou modifiés

- Backend : `prisma/schema.prisma`, nouvelle migration, `src/app.ts`, `src/controllers/prospects.ts`, `src/routes/prospects.ts`, `src/routes/commerce.ts`, `src/validation/commerce.ts`, `tests/commerce.test.mjs`.
- Frontend : `src/App.tsx`, `src/api/prospects.ts`, `src/api/commerce.ts`, `src/components/Prospects.tsx`, `src/components/Clients.tsx`, `src/components/Contracts.tsx`, `src/components/CommercialMetrics.tsx`.
- Documentation : ce fichier.

Les écrans réutilisent les classes du design existant dans styles.css. Les formulaires, listes, confirmations, erreurs, chargements et messages de succès sont intégrés aux rubriques existantes. La fiche client donne accès à l'historique du prospect et à une liste de contrats avec bouton Nouveau contrat.

## Lancement et vérifications

Depuis la racine, PostgreSQL existant : `docker compose up -d postgres`.

Dans un terminal backend :

```powershell
Set-Location backend
npm.cmd run build
npm.cmd run typecheck
npm.cmd run prisma:validate
npm.cmd test
npm.cmd run dev
```

Dans un autre terminal frontend :

```powershell
Set-Location frontend
npm.cmd run build
npm.cmd run dev
```

Après migration autorisée, tests HTTP et persistance PostgreSQL depuis backend :

```powershell
$env:TEST_DATABASE = '1'
npm.cmd test
Remove-Item Env:TEST_DATABASE
```

Les tests créent des enregistrements temporaires et nettoient uniquement leurs propres identifiants, dans l'ordre des clés étrangères. Le test de conversion simule une erreur entre création client et passage à WON pour vérifier le rollback, puis lance deux conversions concurrentes. Les tests PostgreSQL relisent les données après fermeture du pool.

## Résultats automatisés avant migration

- Schéma Prisma : valide.
- Build backend et TypeScript backend : réussis.
- Build frontend (TypeScript et Vite) : réussi.
- Tests : **10 au total, 7 réussis, 3 différés**, aucun échec.
- Couverture exécutée : validations prospects/actions/clients/contrats, dates et fuseaux, CRUD actions avec doubles Prisma, conversion et conservation de l'historique, rollback, double conversion, CRUD clients/contrats, restrictions de suppression, références, filtres, indicateurs incluant exclusion des annulés, conversion monétaire exacte.
- Les 3 tests différés concernent PostgreSQL : prospects, actions et nouvelle mission. Ils restent désactivés sans TEST_DATABASE=1 et ne prouvent donc pas encore la persistance réelle ni les garanties concurrentes de PostgreSQL.

## Tests manuels après autorisation et migration

1. Créer un prospect avec notes et une action ; annuler la confirmation de conversion puis confirmer. Vérifier WON, la conservation du prospect et de l'action, et le lien vers la fiche client.
2. Ouvrir la fiche depuis le lien, vérifier coordonnées, origine et historique ; vérifier le refus de suppression du client et du prospect convertis.
3. Créer directement un client, consulter et modifier ses coordonnées. Créer un contrat depuis sa fiche ; vérifier le compteur de contrats de la liste clients.
4. Dans Contrats, tester filtres client/statut, modification et suppression avec confirmation ; vérifier référence automatique et rejet d'une référence dupliquée.
5. Tester 0,29 € et 12,34 €, montant négatif, trois décimales et date de fin antérieure au début.
6. Créer les six statuts et vérifier les quatre indicateurs ; annuler un contrat signé et vérifier la diminution du montant contractuel signé.
7. Supprimer les contrats d'un client direct, puis ce client. Vérifier qu'un client converti reste protégé.
8. Recharger le navigateur et redémarrer le backend pour vérifier la persistance ; vérifier de nouveau CRUD prospects, actions, transitions et relances.

## Limites connues

- Migration et tests PostgreSQL exécutés avec succès après autorisation.
- Tests visuels manuels du navigateur non effectués avant migration.
- Listes sans pagination, conformément aux écrans existants.
- La suppression des contrats est définitive après confirmation ; l'historique des versions de contrat ne fait pas partie du périmètre.
- Aucun ajout d'authentification, facturation, PDF, signature électronique ou intégration externe.


## Bilan final apres migration autorisee

- Migration 20261008010000_add_clients_contracts appliquee ; schema a jour.
- Inspection finale : aucun DROP, DELETE, UPDATE ou changement des tables existantes.
- Presence confirmee : Prospect, Action, Client et Contract.
- Build backend valide ; tous les tests avec TEST_DATABASE=1 : 10 reussis, 0 echec, 0 ignore.
- Conversion concurrente, conservation des notes et actions, rollback, CRUD clients et contrats, restrictions de suppression, filtres et indicateurs verifies sur PostgreSQL.
- SHA-256 de toutes les lignes avant migration, apres migration et apres nettoyage : 1 prospect et 1 action identiques dans tous leurs champs.
- Aucun client ni contrat preexistant : leurs tables etaient absentes avant migration. Apres nettoyage des seuls identifiants des tests : 0 client, 0 contrat, aucune donnee temporaire residuelle.
- Aucune anomalie detectee. Les sequences ont avance pendant les tests ; aucune reinitialisation.
- Aucun commit ni push. Verification visuelle dans le navigateur non effectuee.
