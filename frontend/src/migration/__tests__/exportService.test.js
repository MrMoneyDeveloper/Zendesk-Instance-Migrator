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

  it("exports only tickets inside the selected created date range", async () => {
    const commentPaths = [];
    const api = {
      fetchAll: async (path, collectionKey) => {
        if (path === "/api/v2/tickets.json" && collectionKey === "tickets") {
          return [
            { id: 1, subject: "Too early", created_at: "2026-01-01T12:00:00Z" },
            { id: 2, subject: "Inside range", created_at: "2026-01-15T12:00:00Z" },
            { id: 3, subject: "Too late", created_at: "2026-02-01T12:00:00Z" },
          ];
        }
        if (collectionKey === "comments") {
          commentPaths.push(path);
          return [{ id: 9, body: "Included comment", public: true, created_at: "2026-01-15T12:30:00Z" }];
        }
        return [];
      },
      request: async () => ({ data: {} }),
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKETS]: true },
      options: {
        ticketExportMode: "date_range",
        ticketDateRange: { from: "2026-01-10", to: "2026-01-31" },
      },
    });

    expect(bundle.objects.tickets).toHaveLength(1);
    expect(bundle.objects.tickets[0].payload.subject).toBe("Inside range");
    expect(commentPaths).toEqual(["/api/v2/tickets/2/comments.json"]);
    expect(bundle.metadata.ticket_filter).toMatchObject({
      mode: "created_at_date_range",
      from: "2026-01-10",
      to: "2026-01-31",
      channels: [],
      comment_mode: "all",
    });
    expect(bundle.metadata.skipped.map((item) => item.reason)).toEqual(["outside_created_at_range", "outside_created_at_range"]);
  });

  it("filters ticket exports by channel and standard ticket fields before fetching comments", async () => {
    const commentPaths = [];
    const api = {
      fetchAll: async (path, collectionKey) => {
        if (path === "/api/v2/tickets.json" && collectionKey === "tickets") {
          return [
            {
              id: 1,
              subject: "Email urgent incident",
              via: { channel: "email" },
              status: "open",
              type: "incident",
              priority: "urgent",
              created_at: "2026-01-15T12:00:00Z",
            },
            {
              id: 2,
              subject: "Web urgent incident",
              via: { channel: "web" },
              status: "open",
              type: "incident",
              priority: "urgent",
              created_at: "2026-01-15T12:00:00Z",
            },
            {
              id: 3,
              subject: "Email low question",
              via: { channel: "email" },
              status: "pending",
              type: "question",
              priority: "low",
              created_at: "2026-01-15T12:00:00Z",
            },
          ];
        }
        if (collectionKey === "comments") {
          commentPaths.push(path);
          return [{ id: 1, body: "Included", public: true, created_at: "2026-01-15T12:00:00Z" }];
        }
        return [];
      },
      request: async () => ({ data: {} }),
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKETS]: true },
      options: {
        ticketDateRange: { from: "2026-01-01", to: "2026-01-31" },
        ticketFilters: {
          channels: ["email"],
          statuses: ["open"],
          types: ["incident"],
          priorities: ["urgent"],
        },
      },
    });

    expect(bundle.objects.tickets).toHaveLength(1);
    expect(bundle.objects.tickets[0].payload.subject).toBe("Email urgent incident");
    expect(commentPaths).toEqual(["/api/v2/tickets/1/comments.json"]);
    expect(bundle.metadata.ticket_filter).toMatchObject({
      channels: ["email"],
      statuses: ["open"],
      types: ["incident"],
      priorities: ["urgent"],
      comment_mode: "all",
    });
    expect(bundle.metadata.skipped.map((item) => item.reason)).toEqual(["outside_ticket_filters", "outside_ticket_filters"]);
  });

  it("filters ticket exports by internal notes", async () => {
    const api = {
      fetchAll: async (path, collectionKey) => {
        if (path === "/api/v2/tickets.json" && collectionKey === "tickets") {
          return [
            { id: 1, subject: "Public only", created_at: "2026-01-15T12:00:00Z" },
            { id: 2, subject: "Has internal note", created_at: "2026-01-15T12:00:00Z" },
          ];
        }
        if (path === "/api/v2/tickets/1/comments.json" && collectionKey === "comments") {
          return [{ id: 1, body: "Public", public: true, created_at: "2026-01-15T12:00:00Z" }];
        }
        if (path === "/api/v2/tickets/2/comments.json" && collectionKey === "comments") {
          return [{ id: 2, body: "Private note", public: false, created_at: "2026-01-15T12:00:00Z" }];
        }
        return [];
      },
      request: async () => ({ data: {} }),
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKETS]: true },
      options: {
        ticketDateRange: { from: "2026-01-01", to: "2026-01-31" },
        ticketFilters: { commentMode: "internal" },
      },
    });

    expect(bundle.objects.tickets).toHaveLength(1);
    expect(bundle.objects.tickets[0].payload.subject).toBe("Has internal note");
    expect(bundle.objects.tickets[0].payload.comments[0].public).toBe(false);
    expect(bundle.metadata.ticket_filter.comment_mode).toBe("internal");
    expect(bundle.metadata.skipped.map((item) => item.reason)).toEqual(["outside_comment_filter"]);
  });

  it("filters ticket exports by custom ticket field values", async () => {
    const commentPaths = [];
    const api = {
      fetchAll: async (path, collectionKey) => {
        if (path === "/api/v2/tickets.json" && collectionKey === "tickets") {
          return [
            {
              id: 1,
              subject: "Billing ticket",
              created_at: "2026-01-15T12:00:00Z",
              custom_fields: [{ id: 12345, value: "billing" }],
            },
            {
              id: 2,
              subject: "Support ticket",
              created_at: "2026-01-15T12:00:00Z",
              custom_fields: [{ id: 12345, value: "support" }],
            },
          ];
        }
        if (collectionKey === "comments") {
          commentPaths.push(path);
          return [{ id: 1, body: "Included", public: true, created_at: "2026-01-15T12:00:00Z" }];
        }
        return [];
      },
      request: async () => ({ data: {} }),
    };

    const bundle = await exportConfiguration({
      api,
      startupState: { context: { subdomain: "source" }, currentUser: {} },
      scope: { [MigrationObjectType.TICKETS]: true },
      options: {
        ticketDateRange: { from: "2026-01-01", to: "2026-01-31" },
        ticketFilters: {
          customFieldFilters: [{ field: "12345", value: "billing" }],
        },
      },
    });

    expect(bundle.objects.tickets).toHaveLength(1);
    expect(bundle.objects.tickets[0].payload.subject).toBe("Billing ticket");
    expect(commentPaths).toEqual(["/api/v2/tickets/1/comments.json"]);
    expect(bundle.metadata.ticket_filter.custom_field_filters).toEqual([{ field: "12345", value: "billing" }]);
    expect(bundle.metadata.skipped.map((item) => item.reason)).toEqual(["outside_ticket_filters"]);
  });
});
