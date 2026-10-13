# Review units for the pending consolidation

The implementation is separated into five behavior-based commits, not one large commit. The user authorized commit and push after cumulative validation. This record does not authorize deployment or declare production readiness.

## Snapshot and boundaries

- Branch: `fix/private-drive-thumbnails`.
- Base: `bb604cd350d9a15cf94499b5ab3ec988778f64ef`.
- The index was empty when this plan was prepared. The implementation was subsequently committed in the sequence below.
- **Exclude `.gitignore`**: its modification belongs to the user.
- This planning document is separate from the five implementation units.
- Counts below include additions and deletions, blank lines, new files, tests, and each unit's README fragment. Recalculate if the worktree changes.

| Order | Proposed conventional commit | Authored lines | Generated lines | Dependency |
| --- | --- | ---: | ---: | --- |
| 1 | `fix(media): serve private Drive thumbnails and clean up cancelled streams` | 249 | 0 | Base |
| 2 | `fix(sync): match Takeout metadata across resumable folder pages` | 348 | 0 | Base |
| 3 | `fix(worker): drain jobs and release queue resources safely` | 384 | 0 | Base |
| 4 | `feat(archive): add bounded private photo removal batches` | 100 | 0 | Base |
| 5 | `fix(settings): preserve pending photo removals and refresh selection` | 347 | 317 | Unit 4 |

The proposed order is a validated cumulative review sequence: each step was tested with preceding units, without later units. Units 2–4 have not been tested independently on the base or in a different order. Unit 5 is 664 changed lines including its generated lockfile, exceeding a 400-line total-diff budget. Review that generated dependency change explicitly; if the future review gate counts it, obtain a size exception rather than dropping tests or hiding the lockfile.

### Created commits

| Unit | Commit |
| --- | --- |
| 1 | `c9bb7e7` |
| 2 | `c9377c5` |
| 3 | `81641b3` |
| 4 | `2f859cd` |
| 5 | `8c6156d` |

Before each commit, staged file contents were compared with the validated sequence, changed-line counts checked, and staged whitespace verified. The user's `.gitignore` modification was excluded and its file hash preserved. Push status is reported separately from this record.

## Exact inclusion map

### 1. Private thumbnails

- `apps/api/src/drive.ts`
- `apps/api/src/media-proxy.service.ts`
- `apps/api/test/drive-media.spec.ts` (new)
- `apps/api/test/media-proxy.service.spec.ts`
- README paragraph beginning `Las miniaturas se obtienen` and its blank separator.

Includes the late-stream cancellation correction. Excludes Takeout and worker lifecycle changes. Rollback boundary: this media behavior and its tests/documentation only.

### 2. Takeout across pages

- `apps/api/src/sync.service.ts`: `TakeoutCandidate`/`FolderWork` types, resumed partial state, folder completion tracking, folder-wide metadata collection and removal of the old per-page collection. Include interrupted-body retries and metadata limits.
- `apps/api/test/robust-sync.spec.ts`
- README paragraph beginning `Takeout recorre primero` and its separator.

Do not include producer fields, `queue()`, `onModuleDestroy()`, removal of the old queue factory, or the enqueue call change. Rollback boundary: Takeout collection/checkpoint behavior and associated tests; leave producer lifecycle intact.

### 3. Queue and worker lifecycle

- `apps/api/src/sync.service.ts`: removal of the old queue factory; producer fields, `queue()`, `onModuleDestroy()`; replacement of `queue().add` with `this.queue().add`.
- `apps/api/src/main.ts`
- `apps/api/src/worker.ts`
- `apps/api/test/sync-enqueue.spec.ts`
- `apps/api/test/worker.spec.ts` (new)
- README paragraph beginning `El productor de sincronización` and its separator.

Includes early-startup cleanup and waiting for pending failure writes when worker close rejects. Excludes Takeout hunks. Rollback boundary: producer/consumer lifecycle and shutdown hooks with their tests; leave metadata matching intact.

### 4. Batch removal API

- `apps/api/src/app.controller.ts`: the `removePhotos` endpoint only; the individual DELETE remains unchanged.
- `apps/api/test/archive-management.spec.ts`
- `apps/api/test/http.integration.spec.ts`
- README endpoint-table row for `POST /v1/photo-removals` and paragraph beginning `La retirada por lotes recibe`, with its separator.

Rollback boundary: the new endpoint and its contract tests/documentation. Existing individual removal remains available. If unit 5 has shipped, remove its dependency first.

### 5. Batch removal in Settings

- `apps/web/lib/photo-removal.ts` (new)
- `apps/web/lib/photo-removal.spec.ts` (new)
- `apps/web/app/settings/page.tsx`
- `apps/web/app/settings/page.spec.tsx` (new)
- `apps/web/package.json`: pinned `jsdom` test dependency.
- `pnpm-lock.yaml`: generated dependency and Vitest peer-resolution changes, including the API importer's peer identifier. Keep the generated lockfile coherent.
- README paragraph beginning `Ajustes envía bloques` and its separator.

Includes the manual-refresh selection lock. Rollback boundary: Settings batch flow, helper, mounted regressions, and their test-only dependency; the API endpoint can remain. No design or chronology changes belong here.

## Recorded verification

All commands below ran against the **combined worktree**, not individual staged units. Counts are evidence from the consolidation review, not a promise that future snapshots pass.

| Scope | Command | Result |
| --- | --- | --- |
| Media | `pnpm --filter @linea-de-vida/api exec vitest run test/drive-media.spec.ts test/media-proxy.service.spec.ts` | 24 passed |
| Takeout | `pnpm --filter @linea-de-vida/api exec vitest run test/robust-sync.spec.ts test/takeout.spec.ts test/sync-takeout.integration.spec.ts` | 30 passed |
| Lifecycle | `pnpm --filter @linea-de-vida/api exec vitest run test/worker.spec.ts test/sync-enqueue.spec.ts` | 15 passed |
| Removal API | `pnpm --filter @linea-de-vida/api exec vitest run test/archive-management.spec.ts test/http.integration.spec.ts` | 35 passed |
| Removal UI | `pnpm --filter @linea-de-vida/web exec vitest run app/settings/page.spec.tsx lib/photo-removal.spec.ts` | 7 passed |
| Full suite | `pnpm test` | 124 API + 18 web = 142 passed |
| Static checks | `pnpm lint` and `pnpm typecheck` | Passed |
| Web build | `pnpm --filter @linea-de-vida/web build` | Passed; existing Next ESLint-plugin warning |
| Whitespace | `git diff --check` | Passed; LF/CRLF warnings only |

The mounted Settings tests use React DOM and jsdom with mocked API/auth/navigation. They cover partial success, lost responses, safe ABSENT retries, stale pagination responses, selection retention and refresh locking. They are not browser visual tests. The `*.integration.spec.ts` names do not imply these scenarios were verified against real infrastructure.

## Delivery gates still open

- Drive: real thumbnail hosts/redirect behavior, cancellation and transfer measurements.
- Takeout: PostgreSQL checkpoint persistence, interruption/restart and concurrent-worker behavior with real services.
- Worker: Redis reconnect, signal-driven shutdown and supervisor termination deadline.
- Removal: PostgreSQL transaction behavior and browser interaction/visual validation.
- Independent review, clean dependency installation and CI validation.

## Cumulative snapshot validation

The base was exported with `git archive` to a temporary directory outside the worktree. Only the inclusion map above was applied, in order, including the partitioned README and `sync.service.ts` changes. No commits, staging, branch changes or remote operations were used.

| Snapshot | API tests | Web tests | Total | Typecheck |
| --- | ---: | ---: | ---: | --- |
| Base + unit 1 | 92 | 11 | 103 | Passed |
| Previous + unit 2 | 102 | 11 | 113 | Passed |
| Previous + unit 3 | 114 | 11 | 125 | Passed |
| Previous + unit 4 | 124 | 11 | 135 | Passed |
| Previous + unit 5 | 124 | 18 | 142 | Passed |

Each snapshot ran `pnpm test` and `pnpm typecheck`. The final snapshot also passed `pnpm lint` and the web production build, with the existing Next ESLint-plugin warning. All 20 included final files match the source worktree after line-ending normalization. Source-file and index fingerprints were unchanged throughout validation. The snapshot retained the base `.gitignore` and excluded the user's modification and this planning document.

Environment: Node `v24.18.0`, pnpm `9.15.4`. Dependency directories were linked to the existing local installation; this is **not clean-install or Node 22 CI evidence**. Local credentials and `.env` files were not copied. Real services and browser behavior remain outside this validation.

Local evidence is retained under `%LOCALAPPDATA%/Temp/opencode/linea-review-iqrne05i/`: per-step logs, `results.json` with file hashes, and the final snapshot. These are temporary local artifacts, not portable committed evidence. The harness hit a Windows stdout encoding error while printing the successful build log; the saved build output and exit code were checked, and the remaining equality checks completed separately. The base `.gitignore` comparison also required CRLF/LF normalization; its content matches.

## Checklist for future revisions

1. Recheck branch, base, worktree and index; preserve any newly encountered user changes.
2. Select by the inclusion map, never by an unrestricted `git add .`. Split shared-file hunks explicitly; ordinary diff context can combine unrelated changes.
3. Verify the selected snapshots still match this validated sequence; rerun checks if their contents change, and run the full suite at delivery close. Testing the complete unstaged worktree alone does not validate the staged snapshot.
4. Inspect each staged diff, including README and new files. Confirm `.gitignore` and unrelated changes are absent.
5. Commit only with explicit authorization. Push, PR creation and deployment require separate authorization.
