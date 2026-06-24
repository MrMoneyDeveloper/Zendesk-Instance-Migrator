import { afterEach, describe, expect, it, vi } from "vitest";

import { executeImport } from "../executor";
import { BUNDLE_VERSION, MIGRATION_OBJECT_ORDER, MigrationObjectType } from "../objectTypes";
import { createCurrentInstanceApi } from "../../zendesk/currentInstanceApi";

function objectsWith(overrides) {
  return MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
    objects[type] = overrides[type] || [];
    return objects;
  }, {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executor", () => {
  it("imports ticket fields with relative current-instance API paths", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { ticket_field: { id: 77, key: body.ticket_field.key, title: body.ticket_field.title } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 12 },
      payload: { key: "customer_type", title: "Customer Type", type: "tagger" },
    };
    const plan = {
      plan_id: "plan-1",
      target: { subdomain: "target" },
      options: { continueOnError: true },
      target_state: { [MigrationObjectType.TICKET_FIELDS]: [] },
      items: [
        {
          object_type: MigrationObjectType.TICKET_FIELDS,
          display_name: "Customer Type",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
        },
      ],
    };

    const report = await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKET_FIELDS]: [sourceItem] }),
        metadata: {},
      },
    });

    expect(calls[0]).toMatchObject({
      path: "/api/v2/ticket_fields.json",
      method: "POST",
      body: { ticket_field: { key: "customer_type", title: "Customer Type", type: "tagger" } },
    });
    expect(report.created_items[0]).toMatchObject({ display_name: "Customer Type", target_id: 77 });
  });

  it("casts view condition values to strings before write", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { view: { id: 303, title: body.view.title } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 88 },
      payload: {
        title: "Finance High Priority Open",
        conditions: {
          all: [{ field: "group_id", operator: "is", value: 22576485641884 }],
          any: [],
        },
      },
    };

    const plan = {
      plan_id: "plan-view-1",
      target: { subdomain: "target" },
      options: { continueOnError: true },
      target_state: { [MigrationObjectType.VIEWS]: [] },
      items: [
        {
          object_type: MigrationObjectType.VIEWS,
          display_name: "Finance High Priority Open",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
        },
      ],
    };

    await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.VIEWS]: [sourceItem] }),
        metadata: {},
      },
    });

    expect(calls[0].path).toBe("/api/v2/views.json");
    expect(calls[0].body.view.conditions.all[0].value).toBe("22576485641884");
  });

  it("imports webhook-dependent automation as inactive when webhook cannot be mapped and inactive policy is selected", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { automation: { id: 601, title: body.automation.title } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 501 },
      payload: {
        title: "Notify on overdue ticket",
        active: true,
        actions: [
          {
            field: "notification_webhook",
            value: ["source-wh-missing", '{ "ticket": { "comment": { "body":"x" } } }'],
          },
        ],
      },
    };

    const plan = {
      plan_id: "plan-automation-1",
      target: { subdomain: "target" },
      options: { continueOnError: true, webhookDependencyPolicy: "inactive", webhookMapping: {} },
      target_state: { [MigrationObjectType.AUTOMATIONS]: [] },
      items: [
        {
          object_type: MigrationObjectType.AUTOMATIONS,
          display_name: "Notify on overdue ticket",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
          auto_mutation_applied: "imported_inactive_due_to_unmapped_webhook",
        },
      ],
    };

    const report = await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({
          [MigrationObjectType.AUTOMATIONS]: [sourceItem],
          [MigrationObjectType.WEBHOOKS]: [{ metadata: { source_id: "source-wh-missing" }, payload: { name: "Missing Webhook" } }],
        }),
        metadata: {},
      },
    });

    expect(calls[0].path).toBe("/api/v2/automations.json");
    expect(calls[0].body.automation.active).toBe(false);
    expect(calls[0].body.automation.actions).toEqual([]);
    expect(report.created_items).toHaveLength(1);
  });

  it("imports tickets through the ticket import API with comments", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { ticket: { id: 9901, external_id: body.ticket.external_id, subject: body.ticket.subject } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 321 },
      payload: {
        external_id: "zendesk-migration:source:ticket:321",
        subject: "Original issue",
        requester_id: 1001,
        status: "closed",
        comments: [{ author_id: 1001, body: "First message", public: true, created_at: "2026-01-01T00:00:00Z" }],
      },
    };
    const plan = {
      plan_id: "plan-ticket-1",
      target: { subdomain: "target" },
      options: { continueOnError: true },
      target_state: { [MigrationObjectType.TICKETS]: [] },
      items: [
        {
          object_type: MigrationObjectType.TICKETS,
          display_name: "Original issue",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
        },
      ],
    };

    const report = await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKETS]: [sourceItem] }),
        metadata: {},
      },
    });

    expect(calls[0]).toMatchObject({
      path: "/api/v2/imports/tickets?archive_immediately=true",
      method: "POST",
      body: {
        ticket: {
          external_id: "zendesk-migration:source:ticket:321",
          subject: "Original issue",
          status: "closed",
          comments: [{ body: "First message", public: true, created_at: "2026-01-01T00:00:00Z" }],
        },
      },
    });
    expect(report.created_items[0]).toMatchObject({ display_name: "Original issue", target_id: 9901, status: "created_with_warnings" });
  });

  it("omits unsupported satisfaction rating scores from ticket imports", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { ticket: { id: 9905, external_id: body.ticket.external_id, subject: body.ticket.subject } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 325 },
      payload: {
        external_id: "zendesk-migration:source:ticket:325",
        subject: "Ticket with offered satisfaction rating",
        satisfaction_rating: { score: "offered" },
        comments: [{ body: "Customer message", public: true }],
      },
    };
    const plan = {
      plan_id: "plan-ticket-satisfaction",
      target: { subdomain: "target" },
      options: { continueOnError: true },
      target_state: { [MigrationObjectType.TICKETS]: [] },
      items: [
        {
          object_type: MigrationObjectType.TICKETS,
          display_name: "Ticket with offered satisfaction rating",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
        },
      ],
    };

    const report = await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKETS]: [sourceItem] }),
        metadata: {},
      },
    });

    expect(calls[0].body.ticket.satisfaction_rating).toBeUndefined();
    expect(report.created_items[0]).toMatchObject({
      display_name: "Ticket with offered satisfaction rating",
      status: "created_with_warnings",
      warnings: ["Removed satisfaction rating because Zendesk ticket import only accepts good or bad scores."],
    });
  });

  it("imports Help Center hierarchy through mapped category and section paths", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          if (url === "/api/v2/help_center/categories.json") {
            return { responseJSON: { category: { id: 901, name: body.category.name } } };
          }
          if (url === "/api/v2/help_center/categories/901/sections.json") {
            return { responseJSON: { section: { id: 902, category_id: 901, name: body.section.name } } };
          }
          if (url === "/api/v2/help_center/sections/902/articles.json") {
            return { responseJSON: { article: { id: 903, section_id: 902, title: body.article.title } } };
          }
          return { responseJSON: {} };
        },
      },
    });

    const category = { metadata: { source_id: 101 }, payload: { name: "Help and FAQs", locale: "en-us" } };
    const section = {
      metadata: { source_id: 202, source_category_id: 101 },
      payload: { category_id: 101, name: "Getting started", locale: "en-us" },
    };
    const article = {
      metadata: { source_id: 303, source_section_id: 202 },
      payload: { section_id: 202, title: "How to start", body: "<p>Start here</p>", locale: "en-us" },
    };

    const report = await executeImport({
      api,
      plan: {
        plan_id: "plan-help-center",
        target: { subdomain: "target" },
        options: { continueOnError: true },
        target_state: {},
        items: [
          { object_type: MigrationObjectType.HELP_CENTER_CATEGORIES, display_name: "Help and FAQs", action: "CREATE", source_item: category, warnings: [] },
          { object_type: MigrationObjectType.HELP_CENTER_SECTIONS, display_name: "Getting started", action: "CREATE", source_item: section, warnings: [] },
          { object_type: MigrationObjectType.HELP_CENTER_ARTICLES, display_name: "How to start", action: "CREATE", source_item: article, warnings: [] },
        ],
      },
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: [category],
          [MigrationObjectType.HELP_CENTER_SECTIONS]: [section],
          [MigrationObjectType.HELP_CENTER_ARTICLES]: [article],
        }),
        metadata: {},
      },
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/v2/help_center/categories.json",
      "/api/v2/help_center/categories/901/sections.json",
      "/api/v2/help_center/sections/902/articles.json",
    ]);
    expect(calls[1].body.section.category_id).toBe(901);
    expect(calls[2].body.article.section_id).toBe(902);
    expect(report.created_items.map((item) => item.target_id)).toEqual([901, 902, 903]);
  });

  it("adds selected target brand internally when creating Help Center categories", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { category: { id: 901, name: body.category.name, brand_id: body.category.brand_id } } };
        },
      },
    });

    const category = { metadata: { source_id: 101 }, payload: { name: "Help and FAQs", locale: "en-us" } };

    await executeImport({
      api,
      plan: {
        plan_id: "plan-help-center-brand",
        target: { subdomain: "target" },
        options: { continueOnError: true, helpCenterTargetBrandId: "12345" },
        target_state: {},
        items: [
          { object_type: MigrationObjectType.HELP_CENTER_CATEGORIES, display_name: "Help and FAQs", action: "CREATE", source_item: category, warnings: [] },
        ],
      },
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: [category],
        }),
        metadata: {},
      },
    });

    expect(calls[0]).toMatchObject({
      path: "/api/v2/help_center/categories.json",
      body: { category: { name: "Help and FAQs", brand_id: "12345" } },
    });
  });

  it("omits unsafe ticket references and reports created_with_warnings", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { ticket: { id: 9902, external_id: body.ticket.external_id, subject: body.ticket.subject } } };
        },
      },
    });

    const sourceItem = {
      metadata: { source_id: 322 },
      payload: {
        external_id: "zendesk-migration:source:ticket:322",
        subject: "Ticket with source IDs",
        requester_id: 1001,
        assignee_id: 1002,
        group_id: 999,
        ticket_form_id: 888,
        custom_fields: [{ id: 777, value: "vip" }],
        comments: [{ author_id: 1001, body: "First message", public: true }],
      },
    };
    const plan = {
      plan_id: "plan-ticket-warnings",
      target: { subdomain: "target" },
      options: { continueOnError: true },
      target_state: { [MigrationObjectType.TICKETS]: [] },
      items: [
        {
          object_type: MigrationObjectType.TICKETS,
          display_name: "Ticket with source IDs",
          action: "CREATE",
          source_item: sourceItem,
          warnings: [],
        },
      ],
    };

    const report = await executeImport({
      api,
      plan,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKETS]: [sourceItem] }),
        metadata: {},
      },
    });

    expect(calls[0].body.ticket).toMatchObject({
      external_id: "zendesk-migration:source:ticket:322",
      subject: "Ticket with source IDs",
    });
    expect(calls[0].body.ticket.requester_id).toBeUndefined();
    expect(calls[0].body.ticket.assignee_id).toBeUndefined();
    expect(calls[0].body.ticket.group_id).toBeUndefined();
    expect(calls[0].body.ticket.ticket_form_id).toBeUndefined();
    expect(calls[0].body.ticket.custom_fields).toBeUndefined();
    expect(calls[0].body.ticket.comments[0].author_id).toBeUndefined();
    expect(report.created_items[0]).toMatchObject({ status: "created_with_warnings", target_id: 9902 });
  });

  it("skips repeated ticket creates by external_id during one import run", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = JSON.parse(data);
          calls.push({ path: url, method: type, body });
          return { responseJSON: { ticket: { id: 9903, external_id: body.ticket.external_id } } };
        },
      },
    });

    const first = {
      metadata: { source_id: 323 },
      payload: { external_id: "zendesk-migration:source:ticket:323", subject: "Duplicate ticket" },
    };
    const second = {
      metadata: { source_id: 323 },
      payload: { external_id: "zendesk-migration:source:ticket:323", subject: "Duplicate ticket again" },
    };

    const report = await executeImport({
      api,
      startupState: { context: { subdomain: "target" } },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKETS]: [first, second] }),
        metadata: {},
      },
      plan: {
        plan_id: "plan-ticket-dupes",
        target: { subdomain: "target" },
        options: { continueOnError: true },
        target_state: { [MigrationObjectType.TICKETS]: [] },
        items: [
          { object_type: MigrationObjectType.TICKETS, display_name: "Duplicate ticket", action: "CREATE", source_item: first, warnings: [] },
          { object_type: MigrationObjectType.TICKETS, display_name: "Duplicate ticket again", action: "CREATE", source_item: second, warnings: [] },
        ],
      },
    });

    expect(calls).toHaveLength(1);
    expect(report.skipped_items[0].reason).toContain("Duplicate ticket");
  });

  it("full ticket migration maps users/orgs and uploads comment attachments", async () => {
    const calls = [];
    const api = createCurrentInstanceApi({
      client: {
        request: async ({ url, type, data }) => {
          const body = data ? JSON.parse(data) : null;
          calls.push({ path: url, method: type, body });

          if (url.includes("/users/search.json")) {
            return { responseJSON: { users: [{ id: 7001, email: "requester@example.com", name: "Requester" }] } };
          }
          if (url === "/api/v2/users/create_or_update.json") {
            return { responseJSON: { user: { id: 7002, email: body.user.email, name: body.user.name } } };
          }
          if (url.includes("/organizations/search.json")) {
            return { responseJSON: { organizations: [] } };
          }
          if (url === "/api/v2/organizations.json") {
            return { responseJSON: { organization: { id: 8001, name: body.organization.name } } };
          }
          if (url === "/api/v2/imports/tickets?archive_immediately=true") {
            return { responseJSON: { ticket: { id: 9904, external_id: body.ticket.external_id } } };
          }
          return { responseJSON: {} };
        },
      },
    });
    api.uploadFile = vi.fn(async ({ fileName }) => ({ upload: { token: `token-${fileName}` } }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "text/plain" },
      blob: async () => new Blob(["hello"], { type: "text/plain" }),
    });

    const sourceItem = {
      metadata: {
        source_id: 324,
        full_ticket_migration: {
          users: {
            1001: { id: 1001, name: "Requester", email: "requester@example.com", role: "end-user" },
            1002: { id: 1002, name: "Assignee", email: "assignee@example.com", role: "agent" },
          },
          organizations: {
            2001: { id: 2001, name: "Source Org" },
          },
          attachments_by_comment_index: {
            0: [{ id: 9, file_name: "note.txt", content_type: "text/plain", content_url: "https://source.zendesk.com/attachments/note.txt" }],
          },
        },
      },
      payload: {
        external_id: "zendesk-migration:source:ticket:324",
        subject: "Full ticket",
        requester_id: 1001,
        assignee_id: 1002,
        organization_id: 2001,
        comments: [{ author_id: 1001, body: "With attachment", public: false, created_at: "2026-01-01T00:00:00Z" }],
      },
    };

    const report = await executeImport({
      api,
      startupState: { context: { subdomain: "target" } },
      fullTicketSetup: { sourceSubdomain: "source", email: "admin@example.com", apiToken: "token" },
      bundle: {
        bundle_version: BUNDLE_VERSION,
        source: { subdomain: "source" },
        objects: objectsWith({ [MigrationObjectType.TICKETS]: [sourceItem] }),
        metadata: {},
      },
      plan: {
        plan_id: "plan-ticket-full",
        target: { subdomain: "target" },
        options: { continueOnError: true, fullTicketMigration: true, fullTicketAutoCreate: true },
        target_state: { [MigrationObjectType.TICKETS]: [] },
        items: [{ object_type: MigrationObjectType.TICKETS, display_name: "Full ticket", action: "CREATE", source_item: sourceItem, warnings: [] }],
      },
    });

    const ticketCall = calls.find((call) => call.path === "/api/v2/imports/tickets?archive_immediately=true");
    expect(ticketCall.body.ticket).toMatchObject({
      requester_id: 7001,
      assignee_id: 7002,
      organization_id: 8001,
    });
    expect(ticketCall.body.ticket.comments[0]).toMatchObject({
      author_id: 7001,
      uploads: ["token-note.txt"],
      public: false,
    });
    expect(api.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ fileName: "note.txt" }));
    expect(report.created_items[0]).toMatchObject({ status: "created_with_warnings", target_id: 9904 });
  });
});
