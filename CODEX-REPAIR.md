# Pages and Codex quota repair (review only)

Based on main `97c1127ea980997c9af2fdeb6dde934091e18a7f`. The earlier staged
November 3 checkout was preserved unchanged. This is a worktree of the same repo.
No push, deployment, rerun, login change, or scheduled task was performed.

## Pages evidence and bounded mitigation

Run 43703642378 uploaded successfully at 10:21:11 UTC, then deployment failed at
10:21:12 with "No artifacts named github-pages". The REST artifacts endpoint later
returned artifact 14157457314, size 661235 bytes, not expired. Previous run
43693801867 succeeded. These facts support temporary artifact-index visibility
failure; they do not prove the internal GitHub service cause. Node deprecation and
runner migration notices are separate warnings, not the reported failure.

The existing deploy-pages v5 source uses @actions/artifact.listArtifacts(), which
queries the runtime-scoped service once. Its error_count input controls deployment
status polling, not this initial lookup. The patch uses the same SDK version pinned
in its upstream lockfile (2.1.8), checks the exact ID from this upload, and retries
only empty results seven times, five seconds apart. Duplicate/wrong/empty artifacts
and API errors stop without attempting deployment. The step has a two-minute cap.
The SDK installs in runner temp before upload, never in the published site.
No permissions or action versions were changed. There is no automatic deployment retry.

This is a mitigation pending a real Actions run, not a proven upstream fix.
The npm install pins the direct SDK version; transitive dependencies are resolved by
npm at run time. The local machine has no npm command, so actual SDK installation
and runtime token behavior remain untested here; retry logic uses injected mocks.

Sources:
- https://github.com/HankYang-1991/ai-office/actions/runs/43703642378
- https://github.com/actions/deploy-pages/blob/v5/src/internal/api-client.js
- https://github.com/actions/deploy-pages/blob/v5/package-lock.json

## Local quota collection and review merge

Use an already signed-in Codex executable; the collector never reads sessions or
auth files. It uses initialize, initialized, account/rateLimits/read and optional
account/rateLimits/updated notifications. Only percentages and times are saved.

```
node scripts/codex-usage.mjs CODEX_EXE ../quota.json
python scripts/merge_codex.py ../quota.json --output ../usage-review.json
```

The second command preserves all team/Grok entries and changes only Codex-owned
quota entries. It does not commit or push. It is compatible with the existing
Crosswalk publisher, which already supports remaining_pct. There is no independent
website data-file overlay and no need to apply the old November 3 patch.

Append --watch to the collector to consume notifications and poll every five minutes
while that process is running. It only writes a local snapshot. No watcher was left
running. No automatic Crosswalk transport or schedule was installed. The existing
Grok relay cadence was not changed or independently verified in this repair.

Unavailable reads write all-null data and exit nonzero; feed this snapshot to the
publisher to clear old numbers. Omitted Codex input preserves old observations without
refreshing their timestamp. UI refresh is 60 seconds. Old (>24h), future-dated,
explicitly stale, or reset-elapsed observations hide numbers; failed overall fetches
never substitute demo Codex quota. Unknown duration is labelled primary/secondary.

Tests: `node --test scripts/repair.test.mjs` and
`python -m unittest discover -s scripts -p test_codex_merge.py -v`.

Before any authorized publication: fetch latest main, reconcile this patch, run tests,
collect a fresh quota snapshot, review only Codex quota deltas, and then approve the
specific push (which triggers Pages). Do not rerun an old run or publish this saved
snapshot blindly. Enabling a sustained local publisher is a separate approval step.
