---
name: worktree-merge
description: Merge toutes les branches des git worktrees vers la branche d'intégration avec vérifications. Use when the user says "merge les worktrees", "merge tous les worktrees", "fusionner les epics", or invokes /worktree-merge.
---

# Worktree Merge

Merge chaque branche portée par un git worktree vers la branche cible,
avec vérifications `npm test && npm run typecheck && npm run depcheck`
(AGENTS.md) après chaque merge, tentative auto sur les conflits triviaux,
puis redistribution de la cible vers chaque worktree pour que tous soient à jour.

## Conventions

- `{repo-root}` : le checkout principal (celui qui porte ce skill).
- `{target}` : branche cible. Défaut : `devlopment` (orthographe racine du
  projet, cf. CLAUDE.md). Alias accepté : si l'utilisateur dit `development`
  et que seule `devlopment` existe, utiliser `devlopment` et le signaler.
  Un `--target <branche>` explicite gagne toujours.
- `{sources}` : branches des worktrees, hors checkout de `{target}`.

## Protocole

### Étape 0 — Résoudre la cible

1. Si `--target` fourni, l'utiliser (vérifier `git rev-parse --verify`).
2. Sinon, si `devlopment` existe, l'utiliser.
3. Sinon, demander à l'utilisateur. Ne jamais deviner en silence.

### Étape 1 — Découverte des sources

```bash
git worktree list --porcelain
git fetch origin
```

- Lister chaque worktree (chemin + branche). Ignorer les detached HEAD
  (signaler, ne pas merger).
- Exclure le worktree déjà sur `{target}` : c'est là que les merges ont lieu.
- Ordre par défaut : alphabétique (`epic-3`, `epic-4`, …). `--order a,b,c`
  surcharge l'ordre.
- Pour chaque source, pré-calculer :
  - `git merge-base --is-ancestor <source> <target>` → déjà mergée : marquer
    `already-up-to-date`, ne rien faire.
  - `git status --porcelain` dans le worktree source → non vide : marquer
    `skipped-dirty`, ne jamais merger un worktree sale.
  - `git rev-list --left-right --count <target>...<source>` → avance/retard.

Présenter le plan (cible, sources ordonnées, statuts pré-vol) avant de merger.

### Étape 2 — Boucle de merge (dans le checkout de `{target}`)

Pour chaque source, dans l'ordre :

```bash
git checkout <target>
git merge --no-ff <source> -m "Merge <source> into <target>"
```

- Un merge par commit (`--no-ff`), comme les story→epic de CLAUDE.md.
- Ne jamais `--force`, ne jamais push automatique (proposer à la fin).
- Ne jamais supprimer un worktree.

### Étape 3 — Conflits (tentative auto, puis stop)

1. Premier essai : merge normal. En cas de conflit, lister les fichiers
   (`git status --porcelain | grep '^UU'`).
2. Tentative auto, uniquement ces deux cas :
   - Retry `git merge --abort` puis `git merge --no-ff -X ignore-space-change`
     : si le conflit n'était que whitespace, garder le résultat en le
     signalant comme `merged-whitespace-retry`.
   - Fichiers ajoutés des deux côtés à contenu identique : accepter tel quel.
3. Tout autre conflit : `git merge --abort` pour revenir à un arbre propre,
   marquer la source `blocked-conflict` avec la liste des fichiers, et HALT :
   arrêter la boucle, ne pas passer à la branche suivante, rapporter la
   commande de reprise (`git merge --no-ff <source>` dans le checkout cible).
4. Ne jamais résoudre un vrai conflit de code en choisissant un camp à
   l'aveugle (`--ours`/`--theirs` global interdit).

### Étape 4 — Vérification après chaque merge réussi

```bash
npm test && npm run typecheck && npm run depcheck
```

- Succès : passer à la source suivante.
- Échec : stop. Marquer `failed-verification` (tests / typecheck / depcheck),
  donner le log pertinent, et indiquer `git reset --hard ORIG_HEAD` comme
  porte de sortie. Ne pas continuer vers la branche suivante.

### Étape 5 — Redistribution vers chaque worktree

Seulement si toutes les sources sont `merged` / `merged-whitespace-retry` /
`already-up-to-date` (aucun `blocked-conflict`, `failed-verification` ou
`skipped-dirty` en suspens — sauf `--force-sync` explicite, qui synchronise
quand même les worktrees propres). `--no-sync` saute cette étape.

Pour chaque worktree source propre, dans son propre chemin (jamais en
changeant la branche du checkout courant — utiliser `git -C <chemin>`) :

```bash
git -C <chemin-worktree> merge --no-ff <target> -m "Sync <branche> with <target>"
```

- Si la branche est déjà ancêtre de `{target}` : `git -C <chemin> merge
  --ff-only <target>` suffit (fast-forward, aucun commit ajouté).
- Worktree sale (`git -C <chemin> status --porcelain` non vide) : marquer
  `not-synced-dirty`, ne pas toucher, indiquer à l'utilisateur de stash/commit
  puis relancer `/worktree-merge --sync-only`.
- Conflit au merge retour : `git -C <chemin> merge --abort`, marquer
  `not-synced-conflict` avec les fichiers, continuer les autres worktrees
  (ici on n'arrête pas la boucle : chaque worktree est indépendant), puis
  rapporter les reprises une par une.
- Ne jamais `--force`, ne jamais rebase (les branches partagées se
  synchronisent par merge, comme story→epic dans CLAUDE.md).

`--sync-only` : saute les étapes 2–4 et ne fait que cette redistribution
(utile après résolution manuelle d'un `blocked-conflict` ou nettoyage d'un
worktree sale).

### Étape 6 — Rapport final

Tableau : chaque source → `merged` / `merged-whitespace-retry` /
`already-up-to-date` / `skipped-dirty` / `blocked-conflict` /
`failed-verification`, avec le hash du merge commit le cas échéant ; puis pour
chaque worktree → `synced` / `synced-ff` / `not-synced-dirty` /
`not-synced-conflict` / `sync-skipped` (`--no-sync`).
Proposer explicitement le push (`git push origin <target>`) au lieu de
l'exécuter. Travail sale laissé derrière : aucun (merges abortés, pas de
commit partiel).

## Exemples

```bash
# Merger tous les worktrees vers devlopment (défaut)
/worktree-merge

# Cible explicite et ordre imposé
/worktree-merge --target devlopment --order epic-3-group-update-migrations,epic-4-shared-types-propagation

# Merger sans redistribuer, ou redistribuer seulement
/worktree-merge --no-sync
/worktree-merge --sync-only
```
