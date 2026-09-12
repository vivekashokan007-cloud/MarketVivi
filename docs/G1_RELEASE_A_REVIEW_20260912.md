# G1 Release A review — 2026-09-12

**Status:** ready for review (Phase 1a applied; Phase 1b stub shipped default-off)  
**Release class:** secure access only. Not a strategy, calibration, or live-trading change.  
**Publishing pause:** lifted by Vivek for this package. Training and live orders remain frozen.

## 1. Why

The Data API still treated the phone as the `anon` role. Critical policies were `USING (true)` / Allow-all. `ml_recommendation_outcomes_archive` had been created with **RLS off** and anon **ALL including TRUNCATE**, so anyone with the published anon key could empty or rewrite the 8,296-row quarantine. TRUNCATE is a table privilege, not a REST DELETE, and it bypasses RLS.

A bare revoke of anon INSERT would break the current APK/PWA recording path (`getBaseRequest` sends only `BuildConfig.SUPABASE_ANON_KEY`). G1 therefore hardens what the current client does not need, and stubs the authenticated bearer path without turning it on.

## 2. What

### Bases at implementation start

| Repo | `origin/main` SHA | Version before |
|---|---|---|
| Marketapp | `8fb1422` (G0 pointer; code pin still 2.6.35/b466) | 2.6.35 / 466 |
| MarketVivi | `f920f31` (G0 evidence manifest) | labels 2.6.35 · b466 |

G1 Marketapp commit: `526c559a88558f76f501b5f64e701b51282a64ce`

### This change set

| Area | Files |
|---|---|
| Access matrix | `MarketVivi/docs/G1_ACCESS_MATRIX_20260912.md` |
| This review | `MarketVivi/docs/G1_RELEASE_A_REVIEW_20260912.md` |
| Already-applied 1a (parent) | `Marketapp/supabase/migrations/20260912154532_g1_archive_rls_and_revoke_truncate.sql` |
| Remaining 1a | `Marketapp/supabase/migrations/20260912162000_g1_phase1a_archive_grants_truncate_delete.sql` |
| Auth stub | `Marketapp/.../AuthAccess.kt`, `AuthAccessTest.kt`, `SupabaseClient.kt`, `NativeBridge.kt`, `MarketRadarApp.kt`, `MarketVivi/app.js` |
| Version | APK `2.6.36` / `467`, `BRAIN_VERSION=2.6.36`, PWA `v2.6.36 · b467` |

Schema/contract: no new tables, no owner columns (none exist to bind). Auth session contract is client-side only: flag default **false**, bearer fallback to anon.

Dependencies: G0 evidence manifest. Does **not** depend on G2–G10. No service_role in APK/PWA.

Unrelated notification WIP (`/workspace/notif-fix`, unpublished `Marketapp-am` commits) was **not** included.

## 3. Evidence

### Pre-fix (G0 + re-verify)

| Probe | Result |
|---|---|
| Archive RLS before parent 1a | `relrowsecurity=false`; anon ALL including TRUNCATE |
| Archive rows | 8296 |
| `getBaseRequest` | anon key as apikey + Bearer only |
| Table DELETE in APK/PWA | none (storage export cleanup only) |
| Owner columns on trades/outcomes/config/models | none |

Parent already applied remote migration `20260912154532_g1_archive_rls_and_revoke_truncate`: archive RLS on, no archive policies, TRUNCATE revoked on the first critical set. Re-verified before continuing.

### Phase 1a remaining (this PR)

Applied remote migration `20260912154943_g1_phase1a_archive_grants_truncate_delete`:

- `REVOKE ALL` on archive from `anon`/`authenticated`
- `REVOKE TRUNCATE` on **all** public tables from `anon`/`authenticated`
- `REVOKE DELETE` on **all** public tables from `anon`
- default privileges: no inherited TRUNCATE; no inherited anon DELETE

### Post-fix assertions (run after apply)

```sql
SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND relname='ml_recommendation_outcomes_archive';
-- expect true

SELECT polname FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='ml_recommendation_outcomes_archive';
-- expect 0 rows

SELECT privilege_type FROM information_schema.role_table_grants
 WHERE table_name='ml_recommendation_outcomes_archive' AND grantee IN ('anon','authenticated');
-- expect 0 rows

SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated');
-- expect 0

SELECT has_table_privilege('anon','public.trades_v2','INSERT') AS trades_insert,
       has_table_privilege('anon','public.trades_v2','DELETE') AS trades_delete,
       has_table_privilege('anon','public.ml_brain_snapshots','INSERT') AS snap_insert,
       has_table_privilege('anon','public.ml_recommendation_outcomes_archive','SELECT') AS archive_select;
-- expect true, false, true, false
```

Actual post-apply catalog (2026-09-12):

| Assertion | Result |
|---|---|
| Archive `relrowsecurity` | true |
| Archive policies | 0 |
| Archive grants to anon/authenticated | 0 |
| TRUNCATE grants to anon/authenticated on public | 0 |
| DELETE grants to anon on public | 0 |
| anon INSERT/UPDATE/SELECT `trades_v2` | true / true / true |
| anon DELETE/TRUNCATE `trades_v2` | false / false |
| anon INSERT `ml_brain_snapshots`, `app_config`, `ml_recommendation_outcomes` | true |
| anon SELECT/INSERT/DELETE/TRUNCATE archive | all false |
| service_role SELECT archive | true |
| `SET ROLE anon; SELECT archive` | **42501 permission denied** |
| `SET ROLE anon; SELECT trades_v2` | **272 rows visible** (recording read still works) |

`AuthAccessTest`: flag off → anon; flag on + empty JWT → anon; flag on + user JWT → user; service_role / `sb_secret_` rejected.

Python unittest command unchanged:

```bash
python3 -m unittest discover -s app/src/main/python/tests -q
```

**Actual result (G1 checkout):** exit 0 — `Ran 605 tests in 3.294s` → `OK`. Brain version bump did not change the 605 count.

Android Gradle / `AuthAccessTest` JVM run was not executed in this box (no claimed JDK/device gate). `OrderExecutionService.EXECUTION_MODE` remains `SANDBOX`.

## 4. Behavior impact

| Surface | Change? |
|---|---|
| Recommendations / ML gate | No |
| Risk / sizing / live orders | No (still frozen / sandbox) |
| Training / promotion | No (still frozen) |
| Recorded trade/eval values | No |
| Archive visibility to anon | Now denied (was already RLS-denied after parent; grants also removed) |
| Anon INSERT on recording tables | **Unchanged** (containment) |
| Observability | Version label 2.6.36 / b467; AuthAccess status JSON |

## 5. Migration

- Staging copy was not available; production grant/RLS changes are **privilege-only** (no row rewrites, no ownership mapping).
- Historic archive rows stay 8296. No owner backfill (none possible without an explicit mapping, which is Phase 2).
- Retry/idempotency of recording is unchanged: anon INSERT/UPDATE still succeed.
- Older APKs keep working because they already use the anon key.

## 6. Recovery

- If a legitimate write fails, check `has_table_privilege` for that table/verb before reverting grants.
- Re-grant only the specific INSERT/SELECT/UPDATE the client needs. **Do not** restore TRUNCATE or archive ALL to anon as routine rollback.
- Auth flag is default off; clearing prefs/`localStorage` returns bearer to anon.
- Forward recovery of business operation is separate from reversal of unsafe permissions.

## 7. Status

**Ready for review.**

| Gate | State |
|---|---|
| Archive not mutable by anon | Met (RLS deny + grants revoked) |
| TRUNCATE gone from anon | Met (all public tables) |
| APK recording path still works with anon | Met (INSERT/SELECT/UPDATE retained; flag default off) |
| Matrix + Auth cutover steps documented | Met |
| Full authenticated ownership + revoke anon INSERT | **Deferred** — containment note in matrix §10. Login UX is a later PR |
| Live trading / training enablement | Not included |
| Release-acceptance item “anonymous writes denied” | **Not claimed** — that is the Auth cutover gate, not Release A Phase 1a |

Next Auth cutover steps are in `docs/G1_ACCESS_MATRIX_20260912.md` §9.
