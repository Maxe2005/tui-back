---
name: bmad-loop-model-maintenance
description: Keep the bmad-loop adapter model matrix (dev/review/triage) in .bmad-loop/policy.toml current and healthy. Use when the user says "vérifie les modèles", "maj les modèles", "check the models", "update the adapter models", "modèles indisponibles", when a bmad-loop run surfaces 429/rate-limit or model-not-found errors, or when starting an epic to confirm the configured models still exist. Read-only drift check by default; applies edits only after user confirmation.
---

# bmad-loop Model Maintenance

**Goal:** Make sure the model matrix in `.bmad-loop/policy.toml` (`[adapter]`,
`[adapter.dev]`, `[adapter.review]`, `[adapter.triage]`) points at models that
still exist, are still reachable with the machine's credentials, and are still
the best available fit. The fallback chain for every stage lives in
`./fallback-matrix.md`.

This skill is **human/agent-triggered** — it is NOT invoked by bmad-loop's own
dev/review/triage sessions. Run it at the start of an epic, or when a run or
`bmad-loop validate` signals a model problem.

## Context: why this drift happens

- The `opencode/` provider (OpenCode Zen) free models are **"limited time"**:
  `hy3-free` was already retired, `nemotron-3-ultra-free` has been flaky. The
  stable survivors are `deepseek-v4-flash-free`, `big-pickle`, `mimo-v2.5-free`.
- The `nvidia/` provider (build.nvidia.com) key is `nvapi-…`, free-tier
  (~40 req/min per model), valid ~6 months, then must be re-issued.
- NVIDIA model slugs get renamed/deprecated as new families ship (e.g. a
  V4 → V4.1 rename would change `deepseek-v4-pro`).
- Context caps matter: opencode Zen free tier = 200k; NVIDIA DeepSeek/Nemotron
  = 1M; Qwen3-Coder = 262k native.

## On Activation

### Step 1 — Read the current matrix

Read `.bmad-loop/policy.toml` and record the resolved models for dev, review,
and triage (stage tables override `[adapter] model`).

### Step 2 — Live catalog check

Run `opencode models`. For each configured slug (full `provider/model` string),
confirm it appears. Note any of:
- **missing slug** → the model was retired or renamed (a drift/MAJ case);
- **present but known-flaky** → e.g. `nemotron-3-ultra-free` upstream failures;
  flag as a risk, propose the fallback if it is in use.

**Warning: `opencode models` is a stale local cache.** It can list models that
are already dead. For any NVIDIA model, cross-check against the live catalog:

```
curl -s -H "Authorization: Bearer $NVIDIA_API_KEY" \
  https://integrate.api.nvidia.com/v1/models
```

(take the key from `~/.local/share/opencode/auth.json` — never print it). Then
probe every candidate before trusting it, one minimal request per model:

```
opencode run --model <provider/model> "Reply with exactly OK"
```

Treat as unusable: `410 Gone` (EOL), `UnknownError`, or a session that starts
but produces no output within ~2 minutes (large models like GLM-5.2 /
Nemotron-3-Ultra hang on the NVIDIA free tier). See `./fallback-matrix.md` for
the verified-working set and the retired list.

### Step 3 — Credentials check

- Confirm `nvidia` is present in `~/.local/share/opencode/auth.json` and its key
  starts with `nvapi-`.
- Record the key's age if derivable; `nvapi-` keys are valid ~6 months. If it is
  near/over expiry, tell the user to regenerate it at build.nvidia.com and run
  `opencode auth login` (or refresh auth) — do not attempt to write a key.
- The `opencode/` free provider needs no stored credential.

### Step 4 — Validate

Run `bmad-loop validate --project .` and read:
- `policy.model-qualified` warning (a model without `/` — opencode-http needs
  `provider/model`);
- `adapter.httpx` / `adapter.binary` / `adapter.hookless` findings;
- `policy` OK line (adapter dev/review/triage names).

### Step 5 — Drift report & apply (only on confirmation)

If any model is missing/renamed/risky, state the drift and consult
`./fallback-matrix.md` for the next-fit candidate, then **ask the user before
editing** `.bmad-loop/policy.toml`. When applying:

- keep `[adapter] name = "opencode-http"` unchanged;
- update only the affected `model = "provider/model"` line(s);
- preserve the existing TOML comments;
- re-run Steps 2 and 4 after editing.

### Step 6 — Optional live probe

If the user wants proof a model actually answers (costs NVIDIA/Zen quota), run
one minimal request per affected model, e.g.:

```
opencode run --model <provider/model> "Reply with exactly OK"
```

This is optional and never automatic.

## Rules

- Never edit `policy.toml` without explicit user confirmation.
- Never write or echo a raw API key.
- Do not touch `[adapter] name`, hooks, or anything outside the model matrix.
- Do not install/upgrade the bmad-loop tool (that is `bmad-loop-setup`'s job).
- If a model is missing and the fallback chain is exhausted, report and ask the
  user to research a replacement rather than inventing a slug.
