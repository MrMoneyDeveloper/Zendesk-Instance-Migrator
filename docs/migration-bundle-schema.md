# Migration Bundle Schema

Bundles are versioned JSON files generated in a source instance and imported in a target instance after validation and dry-run.

```json
{
  "bundle_version": "1.0.0",
  "app_name": "Instance Config Migrator",
  "exported_at": "2026-05-14T00:00:00.000Z",
  "source": {
    "subdomain": "source",
    "account_name": "Source Account",
    "current_user_id": 123,
    "current_user_email": "admin@example.com"
  },
  "scope": {
    "groups": true,
    "ticket_fields": true,
    "ticket_forms": true,
    "macros": true,
    "views": true,
    "ticket_triggers": true,
    "automations": true,
    "webhooks": true,
    "custom_objects": true,
    "custom_object_fields": true,
    "custom_object_relationships": true,
    "custom_object_triggers": true,
    "omnichannel_queues": true,
    "routing_settings": false
  },
  "objects": {
    "groups": [],
    "ticket_fields": [],
    "ticket_forms": [],
    "macros": [],
    "views": [],
    "ticket_triggers": [],
    "automations": [],
    "webhooks": [],
    "custom_objects": [],
    "custom_object_fields": [],
    "custom_object_relationships": [],
    "custom_object_triggers": [],
    "omnichannel_queues": [],
    "routing_settings": []
  },
  "metadata": {
    "counts": {},
    "warnings": [],
    "unsupported": [],
    "skipped": []
  }
}
```

## Object Item Shape

Each exported object is normalized:

```json
{
  "stable_key": "customer_type",
  "display_name": "Customer Type",
  "active": true,
  "payload": {
    "key": "customer_type",
    "title": "Customer Type",
    "type": "tagger"
  },
  "metadata": {
    "source_id": 123456789,
    "order": 12
  },
  "warnings": []
}
```

Rules:

- Source-specific IDs are kept in `metadata.source_id`, not in write payloads.
- Generated timestamps, URLs, self links, and read-only properties are removed from payloads.
- Stable keys, names, titles, active state, and ordering metadata are preserved.
- Webhook secrets are never exported. Webhooks that require unrecoverable authentication are marked with `metadata.skipped_secret_required`.
- Unsupported object types are listed in `metadata.unsupported` with the API path, status, and exact reason.

## Dry-Run Plan Shape

```json
{
  "plan_id": "local-generated-id",
  "created_at": "2026-05-14T00:00:00.000Z",
  "target": {
    "subdomain": "target"
  },
  "summary": {
    "create": 0,
    "update": 0,
    "skip": 0,
    "fail": 0,
    "manual_required": 0
  },
  "items": [
    {
      "object_type": "ticket_fields",
      "source_key": "customer_type",
      "display_name": "Customer Type",
      "action": "CREATE",
      "reason": "No matching target item found.",
      "dependencies": [],
      "warnings": []
    }
  ],
  "warnings": [],
  "blocked": []
}
```

The dry-run never mutates the target instance. Execution requires a dry-run plan and explicit confirmation.
