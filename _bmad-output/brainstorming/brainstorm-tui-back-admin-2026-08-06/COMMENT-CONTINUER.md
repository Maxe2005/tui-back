# Comment reprendre cette session pour la converger plus tard

Cette session de brainstorming (Facilitator) a été close aujourd'hui (2026-08-06) après 4 techniques
(Role Playing, Analyse Morphologique, Disney Method, Job to Be Done). Le statut du memlog est passé
à `complete`, donc l'activation automatique du skill ne la proposera **pas** en reprise — il faut la
pointer explicitement.

## Fichiers de référence

- Memlog complet (source canonique de tout ce qui a été généré) :
  `_bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/.memlog.md`
- Doc d'intention (si générée) : `.../brainstorm-intent.md`

## Étapes pour lancer la convergence plus tard

1. Invoquer le skill `bmad-brainstorming` (taper `/bmad-brainstorming` ou demander à Claude de le lancer).
2. Comme la session est marquée `complete`, elle ne sera pas proposée automatiquement en reprise.
   Dire explicitement quelque chose comme :
   > "Reprends la session de brainstorming
   > `_bmad-output/brainstorming/brainstorm-tui-back-admin-2026-08-06/.memlog.md`,
   > lis-la en entier, puis passe directement à la phase de convergence (`## Converging`)."
3. Le skill va relire le memlog en entier, reconstituer le contexte (mode Facilitator conservé :
   c'est toi qui juges, il structure et pousse — il ne classe rien à ta place), puis lancer une
   **convergence** (`references/converge.md`).
4. Pistes de convergence suggérées vu la matière accumulée (à choisir sur place, pas à l'avance) :
   - **Affinity Clustering** en premier passage : il y a beaucoup d'idées éparses (5 axes, 4 rôles,
     3 pièces Disney, 3 jobs) → les regrouper en thèmes avant de trancher.
   - Puis **Impact–Effort** ou **MoSCoW** pour passer du thème au concret buildable (utile vu que le
     but affiché est de "faire du réel", pas juste explorer).
5. Une fois la convergence faite, le skill enchaîne automatiquement sur `references/finalize.md`
   (nouvelle synthèse, nouveau `status: complete`, proposition d'artefacts : keepsake HTML,
   doc d'intention prêt pour `bmad-product-brief` / `bmad-prd`, etc.)

## Rappel du contenu à trancher en priorité (vu la richesse du memlog)

- Choix du langage/techno TUI (Go+Bubbletea vs Python+Textual vs Node/TS vs coquille+scripts)
- Format concret du "manifeste par repo" (Axe 5) et de la config EDT en SQLite (Axe 2)
- Les 5 deal-breakers de confiance (perte de modifs, lenteur, navigation, boucle de résolution
  d'erreur, vue incomplète) à traiter comme critères d'acceptation, pas comme féatures optionnelles
- Le rôle exact de l'IA (script-first pour rester exécutable par une IA) et ses garde-fous
  (rate-limit, portée, confirmation) avant toute exécution autonome
