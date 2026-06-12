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

  it("exports tickets with importable comments and historical timestamps", async () => {
    const api = {
      fetchAll: async (path, collectionKey) => {
        if (path === "/api/v2/tickets.json" && collectionKey === "tickets") {
          return [
            {
              id: 321,
              subject: "Original issue",
              description: "First message",
              requester_id: 1001,
              organization_id: 2001,
              group_id: 2002,
              status: "closed",
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
              url: "https://source.zendesk.com/api/v2/tickets/321.json",
            },
          ];
        }
        if (path === "/api/v2/tickets/321/comments.json" && collectionKey === "comments") {
          return [
            {
              id: 1,
              author_id: 1001,
              body: "First message",
              public: true,
              created_at: "2026-01-01T00:00:00Z",
              attachments: [{ id: 9, file_name: "receipt.pdf", content_url: "https://source.zendesk.com/attachments/receipt.pdf" }],
            },
            {
              id: 2,
              author_id: 1002,
              body: "Private note",
              public: false,
              created_at: "2026-01-01T01:00:00Z",
            },
          ];
        }
        return [];
      },
      request: async ({ path }) => {
        if (path === "/api/v2/users/1001.json") {
          return { data: { user: { id: 1001, name: "Requester", email: "requester@example.com", role: "end-user" } } };
        }
        if (path === "/api/v2/organizations/2001.json") {
          return { data: { organization: { id: 2001, name: "Source Org" } } };
        }
        return { data: {} };
      },
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKETS]: true },
    });

    const ticket = bundle.objects.tickets[0];
    expect(ticket.payload).toMatchObject({
      subject: "Original issue",
      requester_id: 1001,
      group_id: 2002,
      status: "closed",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      external_id: "zendesk-migration:source:ticket:321",
    });
    expect(ticket.payload.id).toBeUndefined();
    expect(ticket.payload.url).toBeUndefined();
    expect(ticket.payload.comments).toHaveLength(2);
    expect(ticket.payload.comments[0]).toMatchObject({ author_id: 1001, body: "First message", public: true });
    expect(ticket.payload.comments[0].id).toBeUndefined();
    expect(ticket.payload.comments[0].attachments).toBeUndefined();
    expect(ticket.metadata.full_ticket_migration.users["1001"]).toMatchObject({ email: "requester@example.com" });
    expect(ticket.metadata.full_ticket_migration.organizations["2001"]).toMatchObject({ name: "Source Org" });
    expect(ticket.metadata.full_ticket_migration.attachments_by_comment_index["0"][0]).toMatchObject({ file_name: "receipt.pdf" });
    expect(ticket.warnings[0]).toContain("attachments");
  });
});
