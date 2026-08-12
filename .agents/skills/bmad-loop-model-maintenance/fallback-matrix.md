# bmad-loop Model Matrix — Fallback Guide

Current matrix in `.bmad-loop/policy.toml` (opencode-http adapter, `provider/model`
format). This file is the maintenance source of truth — when a model goes away,
move to the next entry in that stage's chain.

> **Lesson learned 2026-08-12:** the local `opencode models` catalog is a **stale
> cache** and lists models that are already dead on the NVIDIA API. Before
> relying on any NVIDIA model, cross-check the live catalog
> (`GET https://integrate.api.nvidia.com/v1/models` with the `nvapi-` key) and
> probe with a one-shot `opencode run --model <id> "Reply with exactly OK"`.
> EOL'd models answer `410 Gone`; very large models (GLM-5.2, Nemotron-3-Ultra)
> start a session but never produce output on the free tier — treat as unusable.

## dev — implements stories (bmad-dev-auto)

| Priority | Model | Status (verified 2026-08-12) |
|---|---|---|
| 1 (current) | `nvidia/nvidia/nemotron-3-super-120b-a12b` | **Works.** NVIDIA current-gen, 1M ctx. Promoted to current 2026-08-12 after `deepseek-v4-flash-free` sustained 429 rate-limits during compaction stalled a run (11 failures / ~35 min). |
| 2 | `opencode/deepseek-v4-flash-free` | **Works** at low volume, but **rate-limits (429) under heavy compaction** on the free Zen tier — 2026-08-12 it stalled a run in `dev-running`. Only fall back here for light/dev-adjacent work; probe before a long run. Risks: 200k ctx cap, "limited time" free period. |
| 3 | `nvidia/minimaxai/minimax-m3` | **Works.** S+ agentic, 1M ctx. |
| 4 | `nvidia/openai/gpt-oss-120b` | **Works.** OpenAI open-weights, solid coder. |

## review — independent second pass (bmad-dev-auto re-invoked on the done spec)

| Priority | Model | Status (verified 2026-08-12) |
|---|---|---|
| 1 (current) | `nvidia/minimaxai/minimax-m3` | **Works.** Deliberately a **different family** from dev (DeepSeek) for independence; 1M ctx lets it read the whole story diff + tests. |
| 2 | `nvidia/nvidia/nemotron-3-super-120b-a12b` | **Works.** NVIDIA family, independent of both dev and review-primary. |
| 3 | `nvidia/openai/gpt-oss-120b` | **Works.** Independent (OpenAI). |
| 4 | `opencode/mimo-v2.5-free` | **Works.** Free, MiniMax family (independent of DeepSeek). |

## triage — deferred-work sweep classification (bmad-loop-sweep)

| Priority | Model | Status (verified 2026-08-12) |
|---|---|---|
| 1 (current) | `opencode/deepseek-v4-flash-free` | **Works.** Free, fast, reliable, 200k ctx — more than enough for triage. |
| 2 | `opencode/big-pickle` | **Works.** Free Zen, stable, stealth DeepSeek V4 Flash alias. |
| 3 | `opencode/mimo-v2.5-free` | **Works.** Free Zen, independent family. |
| 4 | `nvidia/nvidia/nemotron-3-super-120b-a12b` | **Works.** NVIDIA fallback (1M ctx, not free). |

## Retired / unusable (do NOT re-add without re-verifying)

| Model | Reason |
|---|---|
| `nvidia/deepseek-ai/deepseek-v4-pro` | EOL 2026-08-07 → `410 Gone` |
| `nvidia/deepseek-ai/deepseek-v4-flash` | EOL 2026-08-07 → `410 Gone` |
| `nvidia/qwen/qwen3-coder-480b-a35b-instruct` | EOL 2026-06-11 → `410 Gone` |
| `nvidia/deepseek-ai/deepseek-v4-flash-0731` | In live NVIDIA catalog but opencode errors (`UnknownError`) — not in opencode's nvidia registry |
| `nvidia/z-ai/glm-5.2` | Session starts but never responds on the free tier (240s+ no output) |
| `nvidia/nvidia/nemotron-3-ultra-550b-a55b` | Session starts but never responds on the free tier |
| `opencode/hy3-free` | Removed from Zen (no longer free) |
| `opencode/nemotron-3-ultra-free` | Flaky upstream failures (reported) — treat as unstable |

## Watchlist (things that break without any policy change)

- **Zen free models are "limited time"** — check `opencode models` before each
  epic. The reliable survivors are `deepseek-v4-flash-free`, `big-pickle`,
  `mimo-v2.5-free`.
- **`nvapi-` key expiry ~6 months** — regenerate at build.nvidia.com; free tier
  rate limit (~40 RPM/model) is a hard ceiling (429s), no increases granted.
- **NVIDIA catalog churn** — the DeepSeek V4 family was retired wholesale in
  Aug 2026 (V4 → V4.1 era). Re-verify with the live `/v1/models` endpoint, not
  the stale local cache.
- **Large frontier models hang on the free tier** (GLM-5.2, Nemotron-3-Ultra) —
  probe before selecting; prefer the mid-size working models above.
- **`session_budget_mode` is inert for opencode-http** (`usage_parser="none"`) —
  per-session token budgets do not kill opencode sessions; watch stalls instead.

## How to read this table

"Current" = the exact line in `policy.toml` today. Every other row is a fallback
to adopt in order when the current model is retired, renamed, or unusable in
practice (sustained 429, garbage output, hangs). When a fallback becomes
current, re-run the drift check + `bmad-loop validate`.
