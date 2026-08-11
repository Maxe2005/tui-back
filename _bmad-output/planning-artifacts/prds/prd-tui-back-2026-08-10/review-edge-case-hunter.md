# Edge Case Hunter — PRD Review

Target: `prd.md` (full file, no diff). Method: exhaustive path enumeration across every conditional flow named in the request (EDT creation/switch/modify, branch creation and non-member enforcement, group update in both scopes, assisted resolution, shared-types propagation, log observability, route explorer save/re-fire). Findings are unhandled paths only — no severity labels, no editorializing, per method.

```json
[
  {
    "location": "prd.md:121-127 (FR-3)",
    "trigger_condition": "EDT created with a duplicate topic name or zero selected services",
    "guard_snippet": "FR-3 consequence: \"Topic must be unique among existing EDTs; at least one member service is required.\"",
    "potential_consequence": "Ambiguous EDT identity, or an EDT with nothing to act on"
  },
  {
    "location": "prd.md:121-127, 138-144 (FR-3, FR-5)",
    "trigger_condition": "A service is added as a member of two EDTs at once",
    "guard_snippet": "FR-3/FR-5 consequence: \"A service can be a member of at most one EDT at a time.\"",
    "potential_consequence": "Conflicts with FR-8's non-member enforcement — unclear which EDT's branch wins for that service"
  },
  {
    "location": "prd.md:129-136 (FR-4)",
    "trigger_condition": "Chosen base branch or generated branch name doesn't exist/collides in only some of the selected services",
    "guard_snippet": "FR-4 consequence: \"A per-service branch-creation failure is reported per service; it does not abort creation for the others.\"",
    "potential_consequence": "EDT left in an undefined partial state with no stated per-service failure handling"
  },
  {
    "location": "prd.md:138-144 (FR-5)",
    "trigger_condition": "Removing an EDT's last remaining member service",
    "guard_snippet": "FR-5 consequence: \"Removing the last member leaves an empty EDT (allowed) or is blocked — state which.\"",
    "potential_consequence": "Undefined whether an EDT can exist with zero members"
  },
  {
    "location": "prd.md:138-144, 154-159 (FR-5, FR-7)",
    "trigger_condition": "FR-5's branch-change targets a shared/protected branch",
    "guard_snippet": "FR-5 consequence: \"A branch change to a protected branch is rejected per FR-7.\"",
    "potential_consequence": "FR-7's rejection is only stated for EDT creation/assignment, not explicitly for post-creation branch changes"
  },
  {
    "location": "prd.md:146-152 (FR-6)",
    "trigger_condition": "EDT switch triggered while a group update/migration is mid-run on the outgoing EDT",
    "guard_snippet": "FR-6 consequence: \"A switch is blocked (or queued) while a group update is in progress on the outgoing EDT.\"",
    "potential_consequence": "Mid-run script state could be left inconsistent by an in-flight branch switch"
  },
  {
    "location": "prd.md:161-167 (FR-8)",
    "trigger_condition": "Non-member repo's `development` branch was never fetched locally",
    "guard_snippet": "FR-8 consequence: \"The tool fetches before switching a non-member repo to `development` if it isn't present locally.\"",
    "potential_consequence": "Switch target branch may not exist locally, leaving the repo in an undefined state"
  },
  {
    "location": "prd.md:169-175 (FR-9)",
    "trigger_condition": "Branch has no configured upstream (new, never-pushed branch) or no network access",
    "guard_snippet": "FR-9 consequence: \"Divergence shows as 'no upstream' / 'unknown (offline)' rather than a numeric value.\"",
    "potential_consequence": "Divergence display has no defined fallback for these two common states"
  },
  {
    "location": "prd.md:185-191 (FR-10)",
    "trigger_condition": "Group update triggered on an EDT with zero member services",
    "guard_snippet": "FR-10 consequence: \"A group update on an empty EDT scope is a no-op with an explicit message.\"",
    "potential_consequence": "Undefined behavior when there is nothing to update"
  },
  {
    "location": "prd.md:185-191 (FR-10)",
    "trigger_condition": "A second group update (or all-repos mode) is triggered while one is already running",
    "guard_snippet": "FR-10 consequence: \"Concurrent group-update runs are prevented; a second attempt is rejected or queued.\"",
    "potential_consequence": "Overlapping runs could race on the same repo/container/migration state"
  },
  {
    "location": "prd.md:193-202 (FR-11)",
    "trigger_condition": "Developer selects \"cancel\" from the guided conflict menu",
    "guard_snippet": "FR-11 consequence: \"Cancel skips only that repo and continues the run, or aborts the whole run — state which.\"",
    "potential_consequence": "Unclear whether the rest of the EDT's services still get updated"
  },
  {
    "location": "prd.md:193-202 (FR-11)",
    "trigger_condition": "Repo already mid-merge/mid-rebase from a previous interrupted or crashed run",
    "guard_snippet": "FR-11 consequence: \"A repo already in a mid-operation git state is detected as its own case, distinct from lockfile-only-dirty.\"",
    "potential_consequence": "This state fits neither of the two named cases (safe lockfile fix vs. guided menu for a fresh conflict)"
  },
  {
    "location": "prd.md:204-210 (FR-12)",
    "trigger_condition": "A re-triggered migration fails again after the developer's fix",
    "guard_snippet": "FR-12 consequence: \"Repeated failures are surfaced the same way, with no retry limit or escalation path assumed.\"",
    "potential_consequence": "No stated behavior for a fix that doesn't actually resolve the failure"
  },
  {
    "location": "prd.md:220-226 (FR-13)",
    "trigger_condition": "`npm run v` fails after bump+build succeed but before publish/push completes, and the developer re-triggers",
    "guard_snippet": "FR-13 consequence: \"Re-trigger detects which steps already succeeded and resumes, rather than re-running bump from the start.\"",
    "potential_consequence": "A naive re-run risks a duplicate version bump or a publish conflict on an already-published version"
  },
  {
    "location": "prd.md:228-230 (FR-14)",
    "trigger_condition": "An EDT member service's manifest doesn't declare `shared-types-consumer`",
    "guard_snippet": "FR-14 consequence: \"Non-consumer services are omitted from the status view (or shown as N/A) — state which.\"",
    "potential_consequence": "Undefined display for services outside the propagation module's scope"
  },
  {
    "location": "prd.md:249-254 (FR-16)",
    "trigger_condition": "A service in the streamed scope has no running container, or its container crashes mid-stream",
    "guard_snippet": "FR-16 consequence: \"A stopped/crashed service shows as such in the stream view and the tool attempts reconnect when it returns.\"",
    "potential_consequence": "No stated behavior for a missing or interrupted log source"
  },
  {
    "location": "prd.md:256-258 (FR-17)",
    "trigger_condition": "Developer enters an invalid regex in the filter",
    "guard_snippet": "FR-17 consequence: \"An invalid filter expression is rejected with an inline error, not silently ignored or crashing the view.\"",
    "potential_consequence": "Unspecified handling of malformed filter input"
  },
  {
    "location": "prd.md:260-266 (FR-18)",
    "trigger_condition": "Developer triggers restart on a service that is already restarting",
    "guard_snippet": "FR-18 consequence: \"A restart request on an already-restarting service is a no-op / disabled control, not a second concurrent restart.\"",
    "potential_consequence": "Double-restart race not addressed"
  },
  {
    "location": "prd.md:276-282 (FR-19)",
    "trigger_condition": "The active scanner module fails to parse the repo (malformed spec/decorators) or discovers zero routes",
    "guard_snippet": "FR-19 consequence: \"A scan failure or empty result is surfaced explicitly, not shown as an empty route list indistinguishable from 'no routes exist'.\"",
    "potential_consequence": "Developer can't tell a broken scanner apart from a repo that genuinely has no routes"
  },
  {
    "location": "prd.md:284-290 (FR-20)",
    "trigger_condition": "Dev-mode auth token expires mid-session, or the target route needs a permission the dev token doesn't carry",
    "guard_snippet": "FR-20 consequence: \"An expired/insufficient dev token is refreshed or surfaced as a distinct auth error, not a generic request failure.\"",
    "potential_consequence": "\"No manual token re-entry per session\" claim has no stated fallback for expiry or permission mismatch"
  },
  {
    "location": "prd.md:292-298 (FR-21)",
    "trigger_condition": "Save-as-new is given a name that collides with an existing saved request; or a saved request references a route FR-19 no longer discovers after a rescan",
    "guard_snippet": "FR-21 consequence: \"Name collisions on save-as-new are rejected or disambiguated; a saved request pointing at a route no longer discovered is flagged stale, not silently fired.\"",
    "potential_consequence": "Undefined collision handling and undefined behavior for firing a now-nonexistent saved route"
  },
  {
    "location": "prd.md:300-305 (FR-22)",
    "trigger_condition": "The services actually affected by a fired request fall outside the currently aggregated EDT/subset from FR-16",
    "guard_snippet": "FR-22 consequence: \"Affected-service detection is defined (e.g. from the route's manifest-declared owner service) and pulls in logs even if that service isn't in the current FR-16 subset.\"",
    "potential_consequence": "Relevant logs could be silently missing because the affected service isn't part of the aggregated stream's current scope"
  },
  {
    "location": "prd.md (global — no single FR)",
    "trigger_condition": "Two instances of the tool (e.g. two terminal tabs) run concurrently on the same machine",
    "guard_snippet": "Add a Cross-Cutting NFR: \"A second running instance is detected and blocked/warned, since concurrent writers to the same EDT's SQLite file or the same repo's git state are unhandled.\"",
    "potential_consequence": "Concurrent writes to shared local state (SQLite file, git working tree) with no stated mutual exclusion"
  }
]
```
