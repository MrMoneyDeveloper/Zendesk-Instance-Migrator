# Instance Config Migrator

Instance Config Migrator is a private Zendesk Support nav bar app for moving instance configuration with a frontend-only export/import bundle workflow.

The app does not run a backend, does not ask for API tokens, and does not make cross-instance API calls. It only calls the current Zendesk instance through `ZAFClient.init()` and `client.request()` with relative Zendesk API paths such as `/api/v2/ticket_fields.json`.

## Workflow

1. Install or open the app in the source instance.
2. Choose the export scope and run **Export configuration**.
3. Download the generated migration bundle JSON.
4. Install or open the same app in the target instance.
5. Upload the bundle.
6. Validate the bundle and run a mandatory dry-run.
7. Review the create/update/skip/fail/manual-required plan.
8. Confirm execution.
9. Download the final JSON report or CSV summary.

## Exported Configuration

Default selected:

- Groups
- Ticket fields
- Ticket forms
- Macros
- Views
- Ticket triggers
- Automations
- Webhooks
- Custom objects schema
- Custom object fields
- Custom object relationships
- Custom object triggers
- Omnichannel queues

Optional:

- Tickets and comments

Default excluded:

- Help Center articles, categories, and sections
- Users
- Organizations
- Custom object records
- Inactive/deleted records unless explicitly selected
- Webhook secrets
- Runtime telemetry
- Audit logs
- Chat APIs blocked from the Support app context

Routing settings are treated conservatively. The app reports unsupported or readable-but-not-write-confirmed settings instead of blindly overwriting account configuration.

## Security Model

- Uses the logged-in Zendesk admin session only.
- Blocks use by non-admin users.
- Does not request or store API tokens.
- Does not use `localStorage` or `sessionStorage` for credentials.
- Does not export webhook secrets.
- Treat migration bundles as confidential because they contain internal business rules and configuration.
- Ticket migration is best-effort: users, organizations, audit history, metrics, SLAs, and attachment binaries are not migrated by this app.

## Development

```bash
cd frontend
npm install
npm test
npm run build
```

The Vite build writes packaged assets into the root `assets/` directory for Zendesk app packaging.

## Project Layout

```text
manifest.json
translations/en.json
assets/
frontend/
  iframe.html
  src/
    zendesk/currentInstanceApi.js
    migration/
    components/
    utils/
docs/migration-bundle-schema.md
DEPLOYMENT.md
```
