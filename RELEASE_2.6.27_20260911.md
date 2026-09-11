# Market Radar v2.6.27 / b458

The September 11 phone retry stopped during preparation because the locally saved September 10 snapshot at 12:50:55 IST had no corresponding database row. The prior release could reconcile missing IDs only for snapshots already uploaded.

This update replays an absent, ID-less capture using its original saved payload and the existing snapshot persistence path. Evaluation proceeds only after an exact database identity is read back. Conflicting identities remain errors; inputs and previous recovery evidence remain preserved. Retries check for already-committed rows before inserting again.

Android/Kotlin and Python version: 2.6.27, Android build 458. PWA version: 2.6.27 / b458, cache 1334. Trading decisions and Paper/Real behavior are unchanged.

Validation: 526 Python tests passed, Python compilation and PWA JavaScript syntax passed. Six native regression tests cover missing uploads and interrupted recovery. The native safety suite, signed APK build and release publication all passed in [CI run 34568007561](https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/34568007561), on Marketapp commit `c458b6434288112e6ef25c709fbf7a246de2be13`. Debug validation also passed. [Signed release v2.6.27](https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.6.27) was published at 06:01:57 UTC on September 11. On-device evaluation completion remains unverified. Further database schema inspection was blocked by an automatic approval usage-limit rejection.

After a verified signed release is installed, retry September 10 evaluation with existing app data intact. Success requires evaluation completion and persisted outcomes/research, not simply a successful APK build or populated historical ML cards.
