# v2.6.26 / b457 — evaluator identity recovery

The September 10 retry produced a readable local outcomes file but failed to
save it. At 22:21 IST, Supabase rejected null `snapshot_id` values in the first
main-outcome upload chunk and duplicate rejected-outcome IDs in the first
rejected chunk. At 22:25:48, the local reader successfully parsed 8,454 rows,
including 158 rejected rows. This establishes progress beyond the malformed
JSON failure fixed in b456; it does not establish a completed evaluation.

## Corrections

- Before Python evaluation, reconcile all prepared snapshots (including reused
  cached inputs) against a complete, paginated database identity lookup.
  Match exact poll instants within the same IST session, using recommendation
  identity when present. Never guess by candidate, nearest timestamp, or order.
- Preserve the database ID during local compaction when it is available. Local
  snapshots originally saved before the server assigned an ID still require
  reconciliation. Common Python outcomes now carry `snapshot_poll_ts` as local
  provenance, including primary outcomes.
- If existing outcomes have missing/unknown snapshot IDs, retain the original
  file with a UUID `.retained` suffix and regenerate from reconciled inputs.
  Older primary outcomes lack enough provenance for safe direct relabelling.
- Validate required identities and collapse only identical duplicate rows across
  the entire upload set. Conflicting duplicates stop before any upload. Validate
  generated rejected IDs before upload as a further collision check. Deduplication
  retains object references rather than a second full copy of the outcome set.
- Show retry failure phase, snapshot progress, and escaped error text in the PWA.

## Boundaries and verification

- No changes to trading mode, ranking, entry/exit policy, model weights, database
  schema, constraints, or permissions. No manual production data writes.
- Python compilation, the full 525-test suite, JS syntax and whitespace checks
  passed locally. Ten new Kotlin JUnit cases cover
  timestamp normalization, missing/ambiguous identity, repeated recommendations,
  duplicate conflicts, chunk boundaries, and source preservation.
- Native tests could not start locally because Gradle 8.7 could not be downloaded.
  GitHub CI subsequently passed the complete Python suite, Android unit tests,
  and signed APK build on Android commit `a712c785d13db2ab61e349723269d00c1d720c1c`.
  [Signed release run 34548857246](https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/34548857246)
  and [debug run 34548857295](https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/34548857295)
  both completed successfully. [v2.6.26](https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.6.26)
  includes `app-release.apk`, published September 11 at 01:04:28 UTC.
- The earlier GitHub integration write rejection was resolved using newly supplied,
  explicitly authorized credentials. The credential was not written to repository
  files or Git configuration. Device recovery and database upload remain
  field-verification steps; CI success does not establish phone evaluation completion.
- Missing or ambiguous database identity deliberately remains retryable; inputs
  and local outcomes are retained. The app cannot safely attach such outcomes to
  an invented snapshot ID. Do not clear app data before recovery.

Version markers: Kotlin/Android 2.6.26 / 457, Python `BRAIN_VERSION=2.6.26`,
PWA 2.6.26 / b457, `app.js?v=1333`.
