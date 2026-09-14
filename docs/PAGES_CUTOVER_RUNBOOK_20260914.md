# MarketVivi Pages cutover runbook

## Purpose

The repository root contains code, review records, and internal engineering
documents. It must not be the GitHub Pages publishing source. The
`pages-publish.yml` workflow packages only these runtime files:

- `index.html`
- `app.js`
- `api.js`
- `log-viewer.js`
- `style.css`
- `manifest.json`

## Controlled cutover

1. Finish source review and device WebView smoke testing on the intended tip.
2. In GitHub repository **Settings → Pages**, change the source to
   **GitHub Actions**. Do not use `main` root or `/docs` as a Pages source.
3. Confirm the existing Pages site still serves the prior artifact; changing
   the source alone does not publish the new branch files.
4. Dispatch `MarketVivi Pages Publication` on the reviewed commit with
   `confirm_publication=true`.
5. Verify the deployed artifact contains only the six runtime files above and
   that public URLs for `PROJECT_KNOWLEDGE.md`, `docs/`, `CLAUDE.md`, and audit
   or handoff files return 404.
6. Exercise the Android WebView smoke checklist: launch, native bridge,
   Paper Primary, Paper Analysis, 1/2/4-lot persistence, stale authorization,
   and notification recovery.

## Stop conditions

Do not dispatch this workflow until Supabase access controls and the release
approval are separately cleared. A Pages publish changes the WebView-backed
application even without an APK update.
