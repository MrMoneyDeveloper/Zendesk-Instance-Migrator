import { describe, expect, it } from "vitest";

import { buildDryRunPlan } from "../planner";
import { BUNDLE_VERSION, MIGRATION_OBJECT_ORDER, MigrationObjectType } from "../objectTypes";
import { createCurrentInstanceApi } from "../../zendesk/currentInstanceApi";

function objectsWith(overrides) {
  return MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
    objects[type] = overrides[type] || [];
    return objects;
  }, {});
}

function bundle(overrides, scope) {
  return {
    bundle_version: BUNDLE_VERSION,
    app_name: "Instance Config Migrator",
    exported_at: "2026-05-14T00:00:00.000Z",
    source: { subdomain: "source" },
    scope,
    objects: objectsWith(overrides),
    metadata: { counts: {}, warnings: [], unsupported: [], skipped: [] },
  };
}

function apiWithCollections(collections) {
  return createCurrentInstanceApi({
    client: {
      request: async ({ url }) => {
        const response = collections[url];
        if (response instanceof Error) throw response;
        return { responseJSON: response || {} };
      },
    },
  });
}

describe("dry-run plan generation", () => {
  it("plans create and update actions without mutating target", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/groups.json": { groups: [{ id: 10, name: "Support" }] },
      }),
      startupState: { context: { subdomain: "target" } },
      options: { overwriteExisting: true },
      bundle: bundle(
        {
          [MigrationObjectType.GROUPS]: [
            { metadata: { source_id: 1 }, payload: { name: "Support" } },
            { metadata: { source_id: 2 }, payload: { name: "Billing" } },
          ],
        },
        { [MigrationObjectType.GROUPS]: true },
      ),
    });

    expect(plan.summary.update).toBe(1);
    expect(plan.summary.create).toBe(1);
    expect(plan.items.map((item) => item.action)).toEqual(["UPDATE", "CREATE"]);
  });

  it("plans skip when create-only mode sees an existing match", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/groups.json": { groups: [{ id: 10, name: "Support" }] },
      }),
      startupState: { context: { subdomain: "target" } },
      options: { createOnly: true },
      bundle: bundle(
        {
          [MigrationObjectType.GROUPS]: [{ metadata: { source_id: 1 }, payload: { name: "Support" } }],
        },
        { [MigrationObjectType.GROUPS]: true },
      ),
    });

    expect(plan.summary.skip).toBe(1);
    expect(plan.items[0].reason).toContain("create-only");
  });

  it("blocks an item with a missing dependency reference", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/ticket_forms.json": { ticket_forms: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.TICKET_FORMS]: [
            {
              metadata: { source_id: 20 },
              payload: { name: "Support Request", ticket_field_ids: [999] },
            },
          ],
        },
        { [MigrationObjectType.TICKET_FORMS]: true },
      ),
    });

    expect(plan.summary.fail).toBe(1);
    expect(plan.blocked[0].reason).toContain("referenced dependency is missing");
  });

  it("maps auto-included groups before planning dependent view conditions", async () => {
    const group = { metadata: { source_id: 44, required_dependency: true }, payload: { name: "VIP Support" } };
    const view = {
      metadata: { source_id: 10 },
      payload: {
        title: "VIP Group View",
        conditions: { all: [{ field: "group_id", operator: "is", value: 44 }], any: [] },
      },
    };

    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/groups.json": { groups: [{ id: 4400, name: "VIP Support" }] },
        "/api/v2/views.json": { views: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.GROUPS]: [group],
          [MigrationObjectType.VIEWS]: [view],
        },
        {
          [MigrationObjectType.GROUPS]: true,
          [MigrationObjectType.VIEWS]: true,
        },
      ),
    });

    const viewItem = plan.items.find((item) => item.object_type === MigrationObjectType.VIEWS);
    expect(plan.summary.fail).toBe(0);
    expect(viewItem.action).toBe("CREATE");
    expect(viewItem.reason).not.toContain("group_id");
  });

  it("applies webhook dependency policy for rules using notification_webhook", async () => {
    const baseBundle = bundle(
      {
        [MigrationObjectType.AUTOMATIONS]: [
          {
            metadata: { source_id: 55 },
            payload: {
              title: "Webhook Automation",
              actions: [
                {
                  field: "notification_webhook",
                  value: ["source-wh-1", '{ "ticket": { "comment": { "body":"hello" } } }'],
                },
              ],
            },
          },
        ],
      },
      { [MigrationObjectType.AUTOMATIONS]: true },
    );

    const api = apiWithCollections({
      "/api/v2/automations.json": { automations: [] },
    });

    const manualPlan = await buildDryRunPlan({
      api,
      startupState: { context: { subdomain: "target" } },
      options: { webhookDependencyPolicy: "manual_required" },
      bundle: baseBundle,
    });
    expect(manualPlan.items[0].action).toBe("MANUAL_REQUIRED");

    const skipPlan = await buildDryRunPlan({
      api,
      startupState: { context: { subdomain: "target" } },
      options: { webhookDependencyPolicy: "skip" },
      bundle: baseBundle,
    });
    expect(skipPlan.items[0].action).toBe("SKIP");

    const inactivePlan = await buildDryRunPlan({
      api,
      startupState: { context: { subdomain: "target" } },
      options: { webhookDependencyPolicy: "inactive" },
      bundle: baseBundle,
    });
    expect(inactivePlan.items[0].action).toBe("CREATE");
    expect(inactivePlan.items[0].auto_mutation_applied).toBe("imported_inactive_due_to_unmapped_webhook");
  });

  it("does not send tickets with missing references to manual review", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/tickets.json": { tickets: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.TICKETS]: [
            {
              metadata: { source_id: 321 },
              payload: {
                external_id: "zendesk-migration:source:ticket:321",
                subject: "Original issue",
                group_id: 999,
              },
            },
          ],
        },
        { [MigrationObjectType.TICKETS]: true },
      ),
    });

    expect(plan.items[0].action).toBe("CREATE");
    expect(plan.items[0].warnings[0]).toContain("will be omitted");
    expect(plan.summary.manual_required).toBe(0);
    expect(plan.summary.fail).toBe(0);
  });

  it("skips duplicate tickets in the same bundle by external_id", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/tickets.json": { tickets: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.TICKETS]: [
            { metadata: { source_id: 321 }, payload: { external_id: "zendesk-migration:source:ticket:321", subject: "One" } },
            { metadata: { source_id: 321 }, payload: { external_id: "zendesk-migration:source:ticket:321", subject: "One again" } },
          ],
        },
        { [MigrationObjectType.TICKETS]: true },
      ),
    });

    expect(plan.items.map((item) => item.action)).toEqual(["CREATE", "SKIP"]);
    expect(plan.items[1].reason).toContain("Duplicate ticket");
  });

  it("skips tickets outside the selected import created-date range", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/tickets.json": { tickets: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      options: {
        ticketImportDateRange: { from: "2026-01-10", to: "2026-01-20" },
      },
      bundle: bundle(
        {
          [MigrationObjectType.TICKETS]: [
            {
              metadata: { source_id: 321 },
              payload: {
                external_id: "zendesk-migration:source:ticket:321",
                subject: "Inside",
                created_at: "2026-01-15T12:00:00Z",
              },
            },
            {
              metadata: { source_id: 322 },
              payload: {
                external_id: "zendesk-migration:source:ticket:322",
                subject: "Outside",
                created_at: "2026-02-01T12:00:00Z",
              },
            },
          ],
        },
        { [MigrationObjectType.TICKETS]: true },
      ),
    });

    expect(plan.items.map((item) => item.action)).toEqual(["CREATE", "SKIP"]);
    expect(plan.items[1].reason).toContain("outside the selected ticket import range");
    expect(plan.summary.create).toBe(1);
    expect(plan.summary.skip).toBe(1);
    expect(plan.summary.fail).toBe(0);
  });

  it("plans Help Center categories, sections, and articles in hierarchy order with parent matching", async () => {
    const sourceCategory = { metadata: { source_id: 101 }, payload: { name: "Help and FAQs", locale: "en-us" } };
    const sourceSection = {
      metadata: { source_id: 202, source_category_id: 101 },
      payload: { category_id: 101, name: "Getting started", locale: "en-us" },
    };
    const sourceArticle = {
      metadata: { source_id: 303, source_section_id: 202 },
      payload: { section_id: 202, title: "How to start", body: "<p>Start here</p>", locale: "en-us" },
    };

    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/help_center/categories.json": {
          categories: [{ id: 901, name: "Help and FAQs", locale: "en-us" }],
        },
        "/api/v2/help_center/sections.json": {
          sections: [{ id: 902, category_id: 901, name: "Getting started", locale: "en-us" }],
        },
        "/api/v2/help_center/articles.json": {
          articles: [{ id: 903, section_id: 902, title: "How to start", locale: "en-us" }],
        },
      }),
      startupState: { context: { subdomain: "target" } },
      options: { overwriteExisting: true },
      bundle: bundle(
        {
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: [sourceCategory],
          [MigrationObjectType.HELP_CENTER_SECTIONS]: [sourceSection],
          [MigrationObjectType.HELP_CENTER_ARTICLES]: [sourceArticle],
        },
        {
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: true,
          [MigrationObjectType.HELP_CENTER_SECTIONS]: true,
          [MigrationObjectType.HELP_CENTER_ARTICLES]: true,
        },
      ),
    });

    expect(plan.items.map((item) => item.object_type)).toEqual([
      MigrationObjectType.HELP_CENTER_CATEGORIES,
      MigrationObjectType.HELP_CENTER_SECTIONS,
      MigrationObjectType.HELP_CENTER_ARTICLES,
    ]);
    expect(plan.items.map((item) => item.action)).toEqual(["UPDATE", "UPDATE", "UPDATE"]);
    expect(plan.items.map((item) => item.target_id)).toEqual([901, 902, 903]);
  });

  it("plans Help Center hierarchy for create without requiring target URLs", async () => {
    const sourceCategory = { metadata: { source_id: 101 }, payload: { name: "Help and FAQs", locale: "en-us" } };
    const sourceSection = {
      metadata: { source_id: 202, source_category_id: 101 },
      payload: { category_id: 101, name: "Getting started", locale: "en-us" },
    };
    const sourceArticle = {
      metadata: { source_id: 303, source_section_id: 202 },
      payload: { section_id: 202, title: "How to start", body: "<p>Start here</p>", locale: "en-us" },
    };

    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/help_center/categories.json": { categories: [] },
        "/api/v2/help_center/sections.json": { sections: [] },
        "/api/v2/help_center/articles.json": { articles: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: [sourceCategory],
          [MigrationObjectType.HELP_CENTER_SECTIONS]: [sourceSection],
          [MigrationObjectType.HELP_CENTER_ARTICLES]: [sourceArticle],
        },
        {
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: true,
          [MigrationObjectType.HELP_CENTER_SECTIONS]: true,
          [MigrationObjectType.HELP_CENTER_ARTICLES]: true,
        },
      ),
    });

    expect(plan.summary.create).toBe(3);
    expect(plan.summary.fail).toBe(0);
    expect(plan.items.map((item) => item.action)).toEqual(["CREATE", "CREATE", "CREATE"]);
  });

  it("skips ambiguous Help Center matches instead of choosing the wrong parent", async () => {
    const sourceCategory = { metadata: { source_id: 101 }, payload: { name: "Help and FAQs", locale: "en-us" } };

    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/help_center/categories.json": {
          categories: [
            { id: 901, name: "Help and FAQs", locale: "en-us" },
            { id: 902, name: "Help and FAQs", locale: "en-us" },
          ],
        },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.HELP_CENTER_CATEGORIES]: [sourceCategory],
        },
        { [MigrationObjectType.HELP_CENTER_CATEGORIES]: true },
      ),
    });

    expect(plan.summary.skip).toBe(1);
    expect(plan.items[0].reason).toContain("multiple matching Help Center items");
  });

  it("fails a Help Center section when its category is not in the bundle or target mapping", async () => {
    const plan = await buildDryRunPlan({
      api: apiWithCollections({
        "/api/v2/help_center/sections.json": { sections: [] },
      }),
      startupState: { context: { subdomain: "target" } },
      bundle: bundle(
        {
          [MigrationObjectType.HELP_CENTER_SECTIONS]: [
            {
              metadata: { source_id: 202, source_category_id: 999 },
              payload: { category_id: 999, name: "Orphan section", locale: "en-us" },
            },
          ],
        },
        { [MigrationObjectType.HELP_CENTER_SECTIONS]: true },
      ),
    });

    expect(plan.summary.fail).toBe(1);
    expect(plan.blocked[0].reason).toContain("referenced dependency is missing");
    expect(plan.blocked[0].reason).toContain("category_id 999");
  });
});
