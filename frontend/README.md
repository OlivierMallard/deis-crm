# CRM DEIS — Frontend

Interface minimale en React, TypeScript et Vite. Le Dashboard est affiché par défaut ; le menu permet de consulter les emplacements des futures rubriques. Aucune donnée n'est enregistrée.

## Lancement

Depuis la racine du dépôt :

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Ouvrir l'adresse indiquée par Vite, généralement http://localhost:5173.
Sous macOS/Linux, `npm` peut être utilisé à la place de `npm.cmd`.

## Vérification et compilation

```powershell
npm.cmd run build
```

Cette commande vérifie les types TypeScript et produit le frontend dans `dist/`.
