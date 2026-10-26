# Narrow project-knowledge update — domain vs runtime (CDX-GROK-CONTAINMENT-HOSTINGER-R1)

**Date:** 26 October 2026, Asia/Calcutta  
**Status:** draft for review only. **Do not merge to MarketVivi main / Pages in this batch.**  
**Pinned context blob:** `PROJECT_KNOWLEDGE.md` @ `56344c14c16866dc9e8f2baba0c7f20090e2f913` (contains Oracle history; **no** Hostinger hosting reference).

## Confirmed distinction (facts)

| Layer | Fact | Source / checked |
| --- | --- | --- |
| DNS registrar / NS | `marketradar-oracle.online` NS = `orbit.dns-parking.com` / `horizon.dns-parking.com`; SOA MNAME/RNAME includes `dns.hostinger.com` | Cloudflare DoH, 26 Oct 2026 ~08:24 IST |
| A record | `marketradar-oracle.online` → `144.24.117.114` | same |
| IP org | AS31898 Oracle Corporation; geoloc Mumbai (ipinfo) | ipinfo.io, 26 Oct 2026 |
| Historical runtime | June 11 2026 live VM reconciliation: host `144.24.117.114`, user `opc`, dir `/home/opc/oracle_server/`, **not** systemd; `restart.sh`; `.env` clobber bug repaired then | PROJECT_KNOWLEDGE June-11 section |
| App callers | `NativeBridge` `ORACLE_BASE_URL=https://marketradar-oracle.online` (expects `/evaluation-jobs*`); `MarketWatchService` `ELEPHANT_BASE_URL` same host (`/elephant`) | Marketapp source |
| Checked-in Oracle routes | `/health`, `/elephant`, `/monthly_eval` — **not** `/evaluation-jobs*` | `oracle_server/evaluator_app.py` |

## Inferences (not facts)

- Hostinger is the **domain/DNS** purchase path; Oracle Cloud still appears to **host** the A-record target (email-derived finding cited in handoff from Claude addendum 18 Oct; underlying emails not re-read this batch).
- A hostname containing “oracle” or a Hostinger NS does **not** by itself prove the current process/container or credential class.

## Unknowns / blockers

- No SSH/OCI access this batch → deployed source hash, process table, systemd/cron, and runtime env **classes** on the VM are unverified today.
- TLS handshake to `144.24.117.114:443` **timed out** from this agent network (not proof of user-facing outage).
- `/health` GET **skipped by policy** (handoff prefers DNS/cert/repo evidence).
- Whether any Hostinger **VPS** already exists for this project: **unknown** (domain ≠ VPS).

## What must not be assumed

- Do not assume Hostinger replaced Oracle compute.
- Do not assume Always Free idle reclaim caused each reliability incident (platform risk exists per OCI docs; not a verified diagnosis).
- Moving the thin API later does not remove old Edge Functions, old credentials, or phone caches.
