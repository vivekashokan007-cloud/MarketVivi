# G1 Access Matrix — 2026-09-12

**Package:** G1 / Release A (secure access, Phase 1a + 1b stubs)  
**Project:** `fdynxkfxohbnlvayouje`  
**Recording client today:** APK `SupabaseClient.getBaseRequest` and PWA `DB.supabase` use the publishable **anon** key as `apikey` + Bearer. No user JWT. No `service_role` in APK/PWA.  
**Ownership fact:** critical tables have **no** `user_id` / `owner_id` / `account_id` columns. Historic rows cannot be claimed by the first signed-in user.

## How to read this matrix

| Column | Meaning |
|---|---|
| Class | Plan §5 category |
| Current grants (anon) | Table privileges observed 2026-09-12 before/after Phase 1a |
| Current RLS | `relrowsecurity` + policy summary |
| Desired end-state | After Auth cutover (not this PR) |
| Phase | 1a = this release (safe for current anon APK). 1b = session stub only. 2 = revoke anon writes after authenticated path is proven |
| APK / PWA impact | What the current clients do |

Privilege notes:

- **TRUNCATE** is a SQL table privilege, not a PostgREST DELETE route.
- RLS + no policy = deny for `anon`/`authenticated`. `service_role` has `BYPASSRLS`.
- Phase 1a does **not** revoke INSERT/SELECT/UPDATE the recording path still uses.

## 1. User trades

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `trades_v2` | User trades | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (**DELETE revoked**; TRUNCATE already gone) | RLS on. Policy `Allow all trades_v2` ALL / `USING (true)` public | Authenticated ownership; server verifies account. No anon write. No client-supplied owner as authority | 1a grant trim; **Phase 2** policy + revoke INSERT | PWA insert/update trade + close patch. APK SELECT open/closed trades. **Keep INSERT/UPDATE** |
| `trades` | Legacy trades | SELECT only | RLS on. `trades_legacy_app_read` SELECT `USING (true)` | Read-only archive/legacy; service_role for repair | Done-enough; Phase 2 may restrict SELECT | APK/PWA export/read only |
| `trade_log` | User trades / log | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked from anon) | RLS on. Two `Allow all` ALL `USING (true)` | Authenticated owner or service_role. No anon ALL | 1a trim; Phase 2 replace Allow-all | Export/read. No APK DELETE |

## 2. Device observations

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `ml_brain_snapshots` | Device observations | INSERT, SELECT | RLS on. insert+read `WITH CHECK/USING (true)` | Scoped authenticated insert with validated identity + idempotency. Read by owner/device | 1a no change to INSERT/SELECT | APK posts poll snapshots. **Keep INSERT/SELECT** |
| `position_ticks` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. INSERT-only policy `WITH CHECK (true)` | Authenticated insert; no public mutate | 1a TRUNCATE/DELETE; Phase 2 auth insert | APK `insertPositionTicks` only |
| `chain_snapshots` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. `Allow all` ALL `USING (true)` | Authenticated device write; global read optional | 1a trim; Phase 2 | APK upsert/update session snapshots |
| `chain_slices` | Device observations | INSERT, SELECT | RLS on. insert+read true | Same as snapshots | Phase 2 | APK chain fallback insert/read |
| `ml_generated_candidates` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. anon INSERT+SELECT true | Authenticated insert; evaluator/service for research rewrite | 1a trim; Phase 2 | APK evaluation persist |
| `ml_option_chain_snapshots` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. `allow_anon_*` ALL true | Authenticated insert | 1a trim; Phase 2 | APK chain persist |
| `ml_poll_sequences` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. Allow all | Authenticated insert | Phase 2 | Poll bookkeeping |
| `premium_history` | Device observations | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. Allow all | Authenticated or service_role write; broader read OK | Phase 2 | APK SELECT last 60 |
| `sandbox_orders` | Sandbox / not live | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. anon INSERT+SELECT | Authenticated sandbox only. Live path stays disabled | 1a trim; **do not enable live** | APK `insertSandboxOrder` (sandbox-locked) |

## 3. Evaluated outcomes

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `ml_recommendation_outcomes` | Evaluated outcomes | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. `allow_anon_*` ALL true | **Server-side / trusted evaluator writers.** Do not trust a client claim that an evaluation is verified | 1a trim only. **Do not revoke INSERT yet** | APK evening eval persist + readback |
| `ml_evaluation_outcomes` | Evaluated outcomes | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. `anon_rw_ml_eval` ALL true | Same — controlled writer | 1a trim; Phase 2 | APK eval persist |
| `ml_rejected_candidate_outcomes` | Evaluated outcomes | INSERT, SELECT, UPDATE | RLS on. insert/read/update true | Controlled writer | Phase 2 | APK rejected persist |
| `ml_decisions` | Legacy outcomes | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. Allow all | Freeze as legacy; authenticated/service write | Phase 2 | PWA insert/update by `trade_id`; APK fallback read |
| `ml_pc2_authority_decisions` | Evaluated / authority | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. anon read/insert/update true | Server-side authority writer | Phase 2 | APK PC2 persist |
| `ml_context_percentile_history` | Quality / C3 | INSERT, SELECT, UPDATE | RLS on. insert/read/update true | Controlled writer + provenance | Phase 2 | APK C3 finalization |
| `ml_recommendation_outcomes_s1` / `ml_evaluation_outcomes_s1` | Research regen | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. anon INSERT+SELECT | service_role / research host only | Phase 2 | Not the live recording path |

## 4. Global config

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `app_config` | Global config | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. `Allow all` ALL true | Separate global vs per-user settings. Global mutate = service_role or admin. Per-user = owner | 1a trim; Phase 2 **must not** invent a fake owner column for shared keys | APK/PWA upsert poll history, morning baseline, nf50 constituents. **Keep INSERT/UPDATE** |
| `config_nf50_constituents` | Global config | grants remain but **no policies** → RLS deny | RLS on, no policies | service_role or authenticated admin | Already denied by RLS | APK reads constituents via `app_config` key, not this table |

Do not apply a fictitious owner column to shared config.

## 5. Archives

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `ml_recommendation_outcomes_archive` | Archives | **None** (ALL revoked from anon+authenticated). service_role retains DML+TRUNCATE | RLS **on** (parent 1a). **No anon/auth policies** (deny). 8296 quarantine rows | Restricted admin read; **no public mutation** | **1a complete** | APK/PWA do not touch archive. Parent enabled RLS; this PR revoked leftover grants |

## 6. Models and performance

| Table | Class | Current grants (anon) after 1a | Current RLS / policies | Desired end-state | Phase | APK / PWA impact |
|---|---|---|---|---|---|---|
| `ml_models` | Models | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. Allow all | Promotion = service_role only. Client read of approved artifact OK | Phase 2 revoke client write | Training remains frozen; do not promote from APK |
| `ml_performance` | Metrics (legacy) | SELECT, INSERT, UPDATE, REFERENCES, TRIGGER (DELETE+TRUNCATE revoked) | RLS on. Allow all | G6 will version metrics. Writes from trusted evaluator only | Phase 2 | Legacy writer exists; training freeze remains |
| `ml_daily_accuracy` / weekly / monthly (+ lane tables) | Metrics | DELETE revoked from anon; TRUNCATE revoked. Lane tables have RLS + **no policies** (already deny) | Mixed Allow-all vs no-policy deny | service_role / evaluator | Phase 2 for Allow-all siblings | Not required for paper recording |

## 7. Evaluator / teaching / other (inventory)

Tables with RLS on and **no policies** (already deny despite leftover grants):  
`evaluator_jobs`, `evaluator_proposals`, `evaluator_brief_artifacts`, `evaluator_verdict_artifacts`, `historical_option_candles`, `teaching_sessions`, `teaching_snapshots`, `signal_reliability`, `ml_*_accuracy_lane`.

Phase 1a revoked TRUNCATE (anon+authenticated) and DELETE (anon) on these as well. Desired end-state: service_role / authenticated evaluator host only.

Read-mostly market tables (`bhav_options`, `daily_data`, `radar_inputs`, `straddle_ratios`): SELECT + read policies. Keep SELECT for the current app.

Views: `evaluator_proposals_app_view`, `ml_calibration_report` — TRUNCATE/DELETE revoked from anon; treat as evaluator surfaces.

RPCs exposed to anon/authenticated: `touch_updated_at`, `ab_week1_decisions_set_updated_at` (trigger helpers). No extra callable bypass of archive found.

## 8. Client operations verified (do not revoke yet)

APK `SupabaseClient` HTTP verbs: GET / POST / PATCH. **No table DELETE helper.**  
PWA `DB`: `trades_v2` insert/update, `app_config` upsert/select, `ml_decisions` insert/update. **No table `.delete()`.** Storage `EXPORTS.remove` is object storage, not SQL DELETE.

Required until Auth cutover is proven:

- INSERT/SELECT/UPDATE on `trades_v2`, `app_config`, `ml_brain_snapshots`, outcome tables, `position_ticks`, `sandbox_orders`, chain/candidate tables
- SELECT on closed trades, premium history, read-only market tables

**Do not bare-revoke anon INSERT** on those tables in this release.

## 9. Auth cutover plan (Phase 1b documented; not enabled)

1. Add `auth.users` (or equivalent) and an explicit **ownership mapping table** for historic rows. Never infer “all rows belong to the first login.”
2. Ship login UX (Supabase Auth). Device stores **user access JWT only** via `AuthAccess` / `AUTH_ACCESS` (already stubbed; flag default **off**).
3. `getBaseRequest` / PWA `createClient` already add `Authorization: Bearer <user JWT>` when the flag is on and a JWT is present; otherwise they keep the anon key. `apikey` stays the publishable anon key.
4. Prove the full write cycle on a staging/client pair: trade open/close, snapshot, evaluation persist/readback, percentile, offline retry.
5. Replace `USING (true)` with ownership / server-writer policies. UPDATE needs SELECT + old-row and new-row checks.
6. Then revoke anon INSERT/UPDATE on private tables. Do not leave an undocumented permissive compatibility endpoint.
7. Rollback is a compatible secure client/service or local queue — **not** restoring anonymous unrestricted writes.

Feature flags:

- Android prefs `g1_auth_session_enabled` (default false) + `g1_supabase_user_access_token`
- PWA `localStorage['g1_auth_session_enabled']` (`'1'` to enable) + `g1_supabase_user_access_token`
- NativeBridge: `setSupabaseUserSession` / `clearSupabaseUserSession` / `setAuthSessionEnabled` / `getAuthAccessStatus`

`service_role` is rejected if presented to the client store.

## 10. Containment (until Auth cutover)

Anon can still INSERT/UPDATE recording tables through permissive policies. That is **explicitly retained** so the current APK/PWA keep recording. Phase 1a only:

- archive cannot be mutated by anon
- TRUNCATE gone from anon/authenticated on public tables
- DELETE gone from anon on public tables

Training and live orders stay frozen.
