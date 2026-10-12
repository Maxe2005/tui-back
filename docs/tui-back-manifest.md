# Manifeste `.tui-back.yaml`

Ce document décrit exhaustivement les propriétés acceptées par le fichier
`.tui-back.yaml` placé à la racine d'un dépôt géré par `tui-back`.

Le schéma de référence (source de vérité) est le schéma Zod défini dans
[`src/adapters/driven/manifest/schema.ts`](../src/adapters/driven/manifest/schema.ts),
adossé au type `Manifest` de
[`src/core/ports/manifest.ts`](../src/core/ports/manifest.ts).
Le chargement/parsing est fait par
[`src/adapters/driven/manifest/index.ts`](../src/adapters/driven/manifest/index.ts)
(`loadManifest`).

> ⚠️ L'objet racine est validé en mode **strict** (`.strict()`) : toute clé
> autre que celles listées ci-dessous provoque un échec de validation
> (`manifest-validation-failed`).

## Vue d'ensemble

```yaml
# Obligatoire
service: <chaîne non vide>

# Optionnel — absent = service sans conteneur (pas de redémarrage simple, de santé ni de logs)
container: <chaîne non vide>

# Optionnel
migrationCommand: <chaîne non vide>   # omettre la clé si aucune commande

# Optionnel — recette de « clean restart » (commandes shell exécutées dans l'ordre)
restartCommands: [<chaîne non vide>, ...]

# Optionnel — valeur par défaut "development" si la clé est absente
sharedBranch: <chaîne non vide>

# Optionnel — branches protégées du service (en plus de sharedBranch)
protectedBranches: [<chaîne non vide>, ...]

# Obligatoire (peut être un objet vide)
modules:
  <module-id>:                        # doit être un id de module connu (compilé en dur)
    <clé arbitraire>: <valeur arbitraire>   # la valeur doit être un objet, jamais un booléen/tableau/scalaire nu
```

## Référence des propriétés

### `service` (obligatoire)

- **Type** : `string`
- **Validation** : `trim().min(1)` — chaîne non vide après suppression des
  espaces en début/fin ; une valeur composée uniquement d'espaces est
  rejetée.
- **Rôle** : identifiant du service, utilisé pour l'affichage et le
  repérage du dépôt géré.

### `container` (optionnel)

- **Type** : `string`
- **Validation** : `trim().min(1)` — mêmes règles que `service`.
- **Comportement si absent** : le service n'a pas de runtime Docker (pas de
  redémarrage simple, de santé ni de flux de logs). Il reste un membre valide
  d'un EDT. Omettre la clé : `null` ou une chaîne vide sont rejetés.
- **Rôle** : nom du conteneur Docker associé au service (généralement le
  premier service déclaré dans `docker-compose.yml`).

### `migrationCommand` (optionnel)

- **Type** : `string`
- **Validation** : `trim().min(1).optional()` — si la clé est présente, sa
  valeur doit être non vide après trim (une valeur composée uniquement
  d'espaces est rejetée, elle n'est **pas** traitée comme absente).
- **Comportement si absent** : `undefined`, aucune valeur par défaut.
- **Rôle** : commande à exécuter pour lancer les migrations de base de
  données (ex. `docker exec my-service npx prisma migrate deploy`).
- **Note** : la valeur `null` n'est **pas** acceptée par le schéma ; pour
  indiquer l'absence de commande, il faut omettre entièrement la clé.

### `restartCommands` (optionnel)

- **Type** : `string[]`
- **Validation** : tableau de `trim().min(1)` — chaque entrée est rognée et
  doit être non vide. Une valeur qui n'est pas une liste (ex.
  `restartCommands: "make restart"`) ou une entrée vide/blanche provoque un
  échec `manifest-validation-failed`.
- **Comportement si absent** : `undefined` (un tableau vide `[]` est accepté et
  équivaut à l'absence de recette).
- **Rôle** : recette de **clean restart** du service. Au lieu du simple
  redémarrage du conteneur (`container`), `tui-back` exécute ces commandes
  l'une après l'autre (ex. `docker compose down`, `docker compose up -d --build`).
- **Exécution** : chaque commande est passée à `sh -c "<commande>"`, avec le
  **dépôt du service comme répertoire courant**. Elle est non interactive (pas
  de TTY ni de stdin, sortie capturée) et peut donc contenir des pipes, `&&`,
  des variables, etc. Les commandes tournent dans l'ordre déclaré et
  l'exécution **s'arrête à la première qui échoue** (code de sortie ≠ 0) : les
  suivantes ne sont pas lancées et l'erreur `restart-failed` nomme le dépôt, la
  commande et sa sortie d'erreur.
- **Quand la recette est-elle utilisée ?**

  | Contexte | Comportement |
  |-----------|----------------|
  | Mise à jour d'un groupe (EDT) dans le TUI, option **Clean restart** cochée (paramètre global, surchargeable par service dans le tableau) | La recette s'exécute à la place du redémarrage simple du conteneur. |
  | Même mise à jour, **Clean restart** décoché | Redémarrage simple du conteneur ; `restartCommands` est ignoré. |
  | Menu d'un service (zone Update) → **Clean restart** (restart standalone d'un seul service) | La recette s'exécute toujours (le mode clean est implicite). |
  | Mise à jour via la CLI (`tui-back update …`) | Clean restart **toujours désactivé** (pas de flag dédié) : `restartCommands` est ignoré, redémarrage simple du conteneur. |

- **Repli** : si le clean restart est demandé mais que `restartCommands` est
  absent ou vide, `tui-back` retombe **silencieusement** sur le redémarrage
  simple du conteneur. Dans le tableau de configuration du TUI, la colonne
  *Restart* affiche alors `basic (no recipe)` au lieu de `clean`.
- **Exclusivité** : pour un même service et une même action, soit la recette
  s'exécute, soit le redémarrage du conteneur — jamais les deux.
- **Sécurité** : ce sont des commandes shell arbitraires lues dans le
  dépôt ; ne les ajouter que dans des manifestes de confiance.

### `sharedBranch` (optionnel, avec valeur par défaut)

- **Type** : `string`
- **Validation** : `min(1)` (⚠️ non `trim()`é contrairement aux autres
  champs — une chaîne composée uniquement d'espaces passe la validation de
  longueur, mais une chaîne vide explicite `""` est rejetée).
- **Valeur par défaut** : `"development"`, appliquée uniquement quand la
  clé est **absente** du fichier (une valeur vide explicite provoque une
  erreur plutôt que d'utiliser le défaut).
- **Rôle** : nom de la branche Git partagée/de référence pour le dépôt.
  Elle est **toujours** protégée (voir `protectedBranches`).

### `protectedBranches` (optionnel)

- **Type** : `string[]`
- **Validation** : tableau de `trim().min(1)` — chaque entrée est rognée et
  doit être non vide ; les doublons sont tolérés. Une valeur qui n'est pas
  une liste (ex. `protectedBranches: preprod`) ou une entrée vide/blanche
  (`""`, `"   "`) provoque un échec `manifest-validation-failed`, comme
  toute autre erreur de schéma.
- **Comportement si absent** : `undefined` — seule `sharedBranch` est alors
  protégée.
- **Rôle** : branches qu'aucun EDT ne peut revendiquer comme sa propre
  branche (FR-7). L'ensemble protégé d'un service est **exactement**
  `protectedBranches ∪ {sharedBranch}`, comparé à l'identique (sensible à la
  casse). Aucune branche n'est protégée implicitement : `development`,
  `preprod` ou `prod` ne le sont que si le manifeste les liste (ou si l'une
  d'elles est la `sharedBranch`).
- **Effet** : la porte Git (`assertAllowedBranch`, et à travers elle la
  création, le renommage — ancien et nouveau nom — et la création de
  branche de suivi) rejette une branche protégée avec `shared-branch-rejected`
  (`Branch "<nom>" is protected by <service>'s manifest`), avant tout appel
  Git. Le TUI applique la même règle en amont (assistant de création,
  boîte « Configurer », résolution de bascule) avec un message du type
  « « preprod » est protégée par le manifeste de svc-a ».
- **Déploiement** : les manifestes existants ne sont **pas** modifiés
  automatiquement. Un service qui reposait sur l'ancienne protection
  implicite de `development`/`preprod`/`prod` doit ajouter la ligne à la
  main, par exemple `protectedBranches: [development, preprod, prod]` (c'est
  la valeur que le skill `manifest-generator` écrit par défaut).

### `modules` (obligatoire)

- **Type** : `Record<string, Record<string, unknown>>`
- **Validation** :
  - La clé `modules` doit être présente, même si sa valeur est un objet
    vide (`{}`).
  - Chaque valeur doit être un objet/map (`z.record(z.string(), z.unknown())`)
    — une valeur booléenne, un tableau, `null` ou un scalaire nu pour une
    entrée de module est rejeté.
  - Chaque **clé** (id de module) doit correspondre à un id de module
    **connu**, c'est-à-dire compilé en dur dans le registre de modules de
    l'application (voir ci-dessous). Un id inconnu produit une erreur
    dédiée `unknown-module` (et non l'erreur générique de validation).
- **Rôle** : configuration des modules optionnels activés pour ce dépôt.

#### Registre des modules connus

Défini dans
[`src/adapters/driven/modules/module-registry.ts`](../src/adapters/driven/modules/module-registry.ts).
Les ids de modules compilés en dur sont :

| Id de module            | Description                                                                 |
|--------------------------|------------------------------------------------------------------------------|
| `route-explorer`         | Explorateur de routes basé sur une spécification OpenAPI                     |
| `shared-types-source`    | Dépôt qui publie le paquet `shared-types`                                    |
| `shared-types-consumer`  | Service qui dépend du paquet `shared-types` (cible de la propagation de version) |

Toute autre clé sous `modules` échoue la validation avec l'erreur
`unknown-module`.

##### Configuration du module `route-explorer` — découverte (scanner)

Définie dans
[`src/adapters/driven/modules/route-explorer/nestjs-openapi.ts`](../src/adapters/driven/modules/route-explorer/nestjs-openapi.ts).
Toutes les clés sont optionnelles ; le scanner utilise la première trouvée,
dans cet ordre :

- `openapi` — chemin de fichier relatif ou URL `http(s)://` vers une
  spécification OpenAPI 3.x (JSON ou YAML)
- `openapiPath` / `specPath` — chemin de fichier explicite
- `openapiUrl` / `specUrl` — URL explicite

Si aucune de ces clés n'est fournie, le scanner cherche, dans l'ordre, les
fichiers conventionnels suivants à la racine du dépôt : `openapi.json`,
`openapi.yaml`, `openapi.yml`, `swagger.json`, `swagger.yaml`, `swagger.yml`.

Un scan qui échoue (spécification illisible ou non parsable) et une liste
réellement vide sont deux états distincts — un échec n'est jamais rendu
comme une liste vide.

##### Configuration du module `route-explorer` — tir avec auth auto

Définie dans
[`src/adapters/driven/modules/route-explorer/cookie-session-auth.ts`](../src/adapters/driven/modules/route-explorer/cookie-session-auth.ts),
consommée par le use-case
[`src/core/routes/fire-request.ts`](../src/core/routes/fire-request.ts)
(commande `tui-back fire-request <repoPath> <METHOD> <path> [--body <json>]
[--query name=value]... [--header 'Name: value']...` ; dans la zone Routes,
`Entrée` ouvre l'onglet **Request** — Params, Query, Headers, Body — et
`Ctrl+R` tire la requête, la réponse s'affichant dans l'onglet **Response**).

Côté CLI : `--body` n'accepte que du JSON (envoyé avec
`Content-Type: application/json` sauf en-tête `content-type` explicite) et est
refusé sur `GET`/`HEAD` ; un nom de `--query` ou de `--header` répété est
refusé ; un en-tête `cookie` fourni est ignoré (la session d'auth prime). Le
chemin peut être concret (`/users/42` pour la route `/users/{id}`) mais ne
doit contenir ni `?` ni `#` — la query passe par `--query`.

L'auth est une **session cookie** : le module appelle
`GET {baseUrl}{authPath}`, stocke la valeur `Set-Cookie` et l'envoie comme
en-tête `Cookie` à chaque requête tirée. Le service émet son propre JWT —
aucun secret ne figure dans le manifeste et le cookie n'est jamais loggé.

- `baseUrl` — URL de base du service (ex. `http://localhost:3000`).
  **Requise pour tirer** : absente → erreur `missing-base-url` avant tout
  appel réseau. Ignorée par la simple liste des routes.
- `authPath` — chemin de la route d'auth (défaut `/auth/me`).
- `sessionTtlSec` — durée de vie de la session en secondes (défaut `300`,
  avec 30 s de marge de rafraîchissement anticipé).

Comportement du tir :

- La route (`METHOD` + chemin) doit figurer au scan frais, sinon erreur
  `unknown-route` — on ne tire jamais une route inconnue.
- Session expirée → ré-auth silencieuse avant l'envoi ; `401` → ré-auth +
  un seul nouvel essai (max 2 ré-auths consécutives, puis erreur
  `auth-unauthorized`).
- Route d'auth en échec (non-2xx ou réseau) → erreur `auth-endpoint-failed`,
  aucun tir tenté.
- `403` → erreur distincte `auth-forbidden` (mismatch de permission), sans
  nouvel essai.

##### Configuration des modules `shared-types-source` et `shared-types-consumer`

Définies dans
[`src/adapters/driven/modules/shared-types/config.ts`](../src/adapters/driven/modules/shared-types/config.ts).
Contrairement à `route-explorer`, ces deux modules ont un schéma **strict** :
toutes les clés sont optionnelles (valeur par défaut ci-dessous), une clé
inconnue ou une valeur vide/blanche fait échouer le chargement avec
`manifest-validation-failed` (le message nomme le module et le paramètre). Une
entrée `{}` est valide et prend les valeurs par défaut.

| Module                  | Clé               | Défaut                  | Rôle                                                            |
|--------------------------|--------------------|---------------------------|------------------------------------------------------------------|
| `shared-types-source`    | `publishCommand`  | `npm run v`             | Commande de publication du paquet (utilisée par les stories de publication) |
| `shared-types-source`    | `packageName`     | `@ianord/shared-types`  | Nom du paquet, utilisé pour vérifier une version sur le registre npm |
| `shared-types-source`    | `registry`        | `https://npm.ianord.fr` | URL du registre npm qui sert le scope du paquet (passée à `npm view` via `--@scope:registry=…`, `--registry=…` si le paquet n'a pas de scope). Sans elle, npm interroge npmjs.org et ne trouve jamais un paquet privé |
| `shared-types-consumer`  | `dependency`      | `@ianord/shared-types`  | Dépendance dont la ligne de version est lue/réécrite dans `package.json` |
| `shared-types-consumer`  | `packageJsonPath` | `package.json`          | Chemin du `package.json` du service, relatif à son dépôt        |

Déclarer l'un ou l'autre module active l'onglet `shared-types` du TUI (affiché,
masqué ou grisé selon l'appartenance à l'EDT actif). Les opérations
elles-mêmes (lire la version déclarée, réécrire uniquement la ligne de
dépendance, vérifier la publication sur le registre) passent par le port
`SharedTypesPort` ([`src/core/ports/shared-types.ts`](../src/core/ports/shared-types.ts)).

**Mise à jour de groupe « shared-types d'abord »** : lorsque l'EDT actif contient
exactement un dépôt `shared-types-source` (parmi les services de la mise à jour),
l'écran de configuration de la mise à jour (zone Update) affiche une ligne
globale `shared-types` (barre d'espace pour changer) : `off` (défaut), `publish if the
merge changed something` ou `always publish`. Le choix vaut pour le run en cours
uniquement (jamais persisté, aucun changement de manifeste). Dépôt source mis à jour
seul d'abord, puis publication, propagation (avec commit, sans `npm i` ni clean restart,
jamais de push) vers tous les consommateurs de l'EDT, puis mise à jour des autres
services. Un échec met le run en pause (réessayer / ignorer `shared-types` / abandonner).

> Note : toute autre clé sous une entrée de module est acceptée par le
> schéma (les valeurs de `modules.<id>` sont un `Record<string, unknown>`
> libre) mais n'a d'effet que si le code du module correspondant la lit.

## Exemple complet — service `api-gateway` avec `route-explorer`

```yaml
service: api-gateway
container: api-gateway
migrationCommand: docker exec api-gateway npx prisma migrate deploy
restartCommands:
  - docker compose down
  - docker compose up -d --build
sharedBranch: development
protectedBranches: [development, preprod, prod]
modules:
  route-explorer:
    # Découverte : spécification OpenAPI exposée par le service
    openapiUrl: http://localhost:3000/api-json
    # Tir avec auth auto : session cookie via GET {baseUrl}{authPath}
    baseUrl: http://localhost:3000
    authPath: /auth/me
    sessionTtlSec: 300
```

(`authPath` et `sessionTtlSec` pourraient être omis ici : leurs défauts
`/auth/me` et `300` s'appliqueraient. `baseUrl` est en revanche obligatoire
dès qu'on veut tirer des requêtes.)

## Exemple — service consommateur de `shared-types`

```yaml
service: orders-api
container: orders-api
sharedBranch: development
modules:
  shared-types-consumer: {}   # défauts : @ianord/shared-types, package.json
```

Le dépôt source, lui, déclare `shared-types-source: {}` (ou surcharge
`publishCommand` / `packageName`) — il peut ne pas avoir de `container`.

L'onglet `shared-types` est piloté par `shared-types-source` uniquement, comme l'onglet Routes
l'est par `route-explorer` : il est masqué tant qu'aucun dépôt enregistré ne déclare
`shared-types-source`, grisé si le service source n'est pas membre de l'EDT actif, et actif
sinon. `shared-types-consumer` ne dépend que de lui et n'influence jamais l'onglet.

## Exemple minimal

```yaml
service: repo_1
container: repo_1-back
sharedBranch: master
modules: {}
```

(`migrationCommand` et `restartCommands` omis — le clean restart retombe alors
sur le redémarrage simple du conteneur —, `sharedBranch` explicite ici mais pourrait aussi
être omis pour hériter de `"development"`. `protectedBranches` omis : seule
`master` est protégée.)

## Erreurs de chargement possibles

Le loader (`loadManifest`) peut renvoyer les codes d'erreur suivants :

| Code                         | Cause                                                              |
|-------------------------------|---------------------------------------------------------------------|
| `manifest-not-found`          | Le fichier `.tui-back.yaml` n'existe pas à la racine du dépôt (le dépôt est alors considéré comme non géré, ce n'est pas un crash). |
| `manifest-read-error`         | Erreur de lecture du fichier (droits, etc.).                        |
| `manifest-invalid-yaml`       | Le contenu n'est pas un YAML valide.                                 |
| `manifest-validation-failed`  | Le document ne respecte pas le schéma (champ manquant, type invalide, clé inconnue au niveau racine, valeur de module non-objet, paramètre inconnu ou vide d'un module `shared-types-*`, etc.). Le message précise le chemin du premier problème rencontré. |
| `unknown-module`               | Une clé sous `modules` ne correspond à aucun id de module connu (registre `knownModuleIds`). |

## Comportement lors d'un switch d'EDT

Un `.tui-back.yaml` modifié (non commité) n'est jamais mis en stash, adopté ni abandonné lors d'un
`edt switch` : il est retrouvé tel quel après le switch, quelle que soit la version (ou l'absence)
du fichier sur la branche cible. Il apparaît alors modifié par rapport à cette branche.

## Sources

- Schéma Zod : `src/adapters/driven/manifest/schema.ts`
- Type `Manifest` : `src/core/ports/manifest.ts`
- Loader : `src/adapters/driven/manifest/index.ts`
- Clean restart (recette `restartCommands`) : `src/core/scripts/group-update.ts` (`runRestartStep`),
  `src/core/scripts/service-restart.ts`, `src/core/ports/restart.ts`,
  `src/adapters/driven/restart/index.ts`
- Registre des modules : `src/adapters/driven/modules/module-registry.ts`
- Modules `shared-types` : `src/adapters/driven/modules/shared-types/config.ts`, `src/adapters/driven/modules/shared-types/npm-package.ts`, `src/core/ports/shared-types.ts`
- Scanner `route-explorer` : `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts`
- Auth session cookie : `src/adapters/driven/modules/route-explorer/cookie-session-auth.ts`
- Tir de requête : `src/core/routes/fire-request.ts`
- Tests de référence : `src/adapters/driven/manifest/index.test.ts`
