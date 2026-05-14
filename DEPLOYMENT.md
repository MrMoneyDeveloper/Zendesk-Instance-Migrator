# Deployment

## Build

```bash
cd frontend
npm install
npm test
npm run build
```

The build outputs `assets/iframe.html`, `assets/index-[hash].js`, and `assets/index-[hash].css`. Existing icons remain in `assets/`.

## Package as a Private App

Package these root-level files and folders:

```text
manifest.json
translations/
assets/
```

Required packaged files:

```text
manifest.json
translations/en.json
assets/iframe.html
assets/logo.png
assets/logo-small.png
assets/icon_nav_bar.svg
assets/index-[hash].js
assets/index-[hash].css
```

## Manual Acceptance Test

1. Build the app.
2. Package the root `manifest.json`, `translations/`, and `assets/`.
3. Install the app in a source sandbox.
4. Export selected configuration.
5. Confirm the JSON bundle downloads.
6. Install the same app in a target sandbox.
7. Upload the bundle.
8. Run dry-run.
9. Confirm no target mutation occurs before execution.
10. Confirm the import checkbox and execute.
11. Confirm objects are created or updated in the target instance.
12. Confirm triggers, automations, and queues preserve order where the API supports reordering.
13. Confirm excluded objects are not migrated: tickets, Help Center content, users, organizations, and custom object records.
14. Confirm unsupported items are reported clearly.
15. Download and review the final JSON report and CSV summary.

## Packaging Notes

- The app name is `Instance Config Migrator`.
- `manifest.json` points to `assets/iframe.html` under `location.support.nav_bar`.
- No backend host, backend scheme, backend shared secret, or backend domain whitelist is required.
- Zendesk API calls must remain relative current-instance paths.
