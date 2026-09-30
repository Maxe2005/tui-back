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
container: <chaîne non vide>

# Optionnel
migrationCommand: <chaîne non vide>   # omettre la clé si aucune commande

# Optionnel — valeur par défaut "development" si la clé est absente
sharedBranch: <chaîne non vide>

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

### `container` (obligatoire)

- **Type** : `string`
- **Validation** : `trim().min(1)` — mêmes règles que `service`.
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

### `sharedBranch` (optionnel, avec valeur par défaut)

- **Type** : `string`
- **Validation** : `min(1)` (⚠️ non `trim()`é contrairement aux autres
  champs — une chaîne composée uniquement d'espaces passe la validation de
  longueur, mais une chaîne vide explicite `""` est rejetée).
- **Valeur par défaut** : `"development"`, appliquée uniquement quand la
  clé est **absente** du fichier (une valeur vide explicite provoque une
  erreur plutôt que d'utiliser le défaut).
- **Rôle** : nom de la branche Git partagée/de référence pour le dépôt.

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
À ce jour, le seul id de module compilé en dur est :

| Id de module     | Description                                            |
|-------------------|----------------------------------------------------------|
| `route-explorer`  | Explorateur de routes basé sur une spécification OpenAPI |

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
(commande `tui-back fire-request <repoPath> <METHOD> <path>`, touche `Entrée`
dans la zone Routes).

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

> Note : toute autre clé sous une entrée de module est acceptée par le
> schéma (les valeurs de `modules.<id>` sont un `Record<string, unknown>`
> libre) mais n'a d'effet que si le code du module correspondant la lit.

## Exemple complet — service `api-gateway` avec `route-explorer`

```yaml
service: api-gateway
container: api-gateway
migrationCommand: docker exec api-gateway npx prisma migrate deploy
sharedBranch: development
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

## Exemple minimal

```yaml
service: repo_1
container: repo_1-back
sharedBranch: master
modules: {}
```

(`migrationCommand` omis, `sharedBranch` explicite ici mais pourrait aussi
être omis pour hériter de `"development"`.)

## Erreurs de chargement possibles

Le loader (`loadManifest`) peut renvoyer les codes d'erreur suivants :

| Code                         | Cause                                                              |
|-------------------------------|---------------------------------------------------------------------|
| `manifest-not-found`          | Le fichier `.tui-back.yaml` n'existe pas à la racine du dépôt (le dépôt est alors considéré comme non géré, ce n'est pas un crash). |
| `manifest-read-error`         | Erreur de lecture du fichier (droits, etc.).                        |
| `manifest-invalid-yaml`       | Le contenu n'est pas un YAML valide.                                 |
| `manifest-validation-failed`  | Le document ne respecte pas le schéma (champ manquant, type invalide, clé inconnue au niveau racine, valeur de module non-objet, etc.). Le message précise le chemin du premier problème rencontré. |
| `unknown-module`               | Une clé sous `modules` ne correspond à aucun id de module connu (registre `knownModuleIds`). |

## Sources

- Schéma Zod : `src/adapters/driven/manifest/schema.ts`
- Type `Manifest` : `src/core/ports/manifest.ts`
- Loader : `src/adapters/driven/manifest/index.ts`
- Registre des modules : `src/adapters/driven/modules/module-registry.ts`
- Scanner `route-explorer` : `src/adapters/driven/modules/route-explorer/nestjs-openapi.ts`
- Auth session cookie : `src/adapters/driven/modules/route-explorer/cookie-session-auth.ts`
- Tir de requête : `src/core/routes/fire-request.ts`
- Tests de référence : `src/adapters/driven/manifest/index.test.ts`
