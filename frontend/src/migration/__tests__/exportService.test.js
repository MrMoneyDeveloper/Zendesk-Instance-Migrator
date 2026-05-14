import { describe, expect, it } from "vitest";

import { exportConfiguration, normalizeForBundle } from "../exportService";
import { MigrationObjectType } from "../objectTypes";
import { createCurrentInstanceApi } from "../../zendesk/currentInstanceApi";

describe("export service", () => {
  it("exports groups through the current-instance API wrapper", async () => {
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url }) => {
          expect(url).toBe("/api/v2/groups.json");
          return {
            responseJSON: {
              groups: [{ id: 1, name: "Support", url: "https://example.zendesk.com/api/v2/groups/1.json" }],
            },
          };
        },
      },
    });

    const bundle = await exportConfiguration({
      api,
      startupState: {
        context: { subdomain: "source", account_name: "Source" },
        currentUser: { id: 123, email: "admin@example.com" },
      },
      scope: { [MigrationObjectType.GROUPS]: true },
    });

    expect(bundle.objects.groups).toHaveLength(1);
    expect(bundle.objects.groups[0].metadata.source_id).toBe(1);
    expect(bundle.objects.groups[0].payload.id).toBeUndefined();
    expect(bundle.objects.groups[0].payload.url).toBeUndefined();
  });

  it("exports ticket fields and strips generated ids from write payloads", async () => {
    const api = {
      fetchAll: async () => [
        {
          id: 5,
          key: "customer_type",
          title: "Customer Type",
          type: "tagger",
          created_at: "2026-05-14T00:00:00Z",
        },
      ],
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKET_FIELDS]: true },
    });

    expect(bundle.objects.ticket_fields[0].payload).toMatchObject({ key: "customer_type", title: "Customer Type" });
    expect(bundle.objects.ticket_fields[0].payload.created_at).toBeUndefined();
  });

  it("marks webhooks with unrecoverable secrets for manual reconfiguration", () => {
    const item = normalizeForBundle(MigrationObjectType.WEBHOOKS, {
      id: "abc",
      name: "Notify CRM",
      endpoint: "https://example.test/hook",
      authentication: { type: "bearer_token", data: { token: "secret" } },
    });

    expect(item.metadata.skipped_secret_required).toBe(true);
    expect(item.payload.authentication).toBeUndefined();
    expect(item.warnings[0]).toContain("manual secret reconfiguration");
  });

  it("preserves business rule condition values while removing read-only fields", () => {
    const item = normalizeForBundle(MigrationObjectType.TICKET_TRIGGERS, {
      id: 9,
      title: "Escalate VIP",
      conditions: { all: [{ field: "priority", operator: "is", value: "urgent" }], any: [] },
      actions: [{ field: "group_id", value: "123" }],
      created_at: "2026-05-14T00:00:00Z",
    });

    expect(item.payload.conditions.all[0].value).toBe("urgent");
    expect(item.payload.actions[0].value).toBe("123");
    expect(item.payload.created_at).toBeUndefined();
  });
});
