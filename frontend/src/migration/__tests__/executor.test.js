import { describe, expect, it } from "vitest";

import { executeImport } from "../executor";
import { BUNDLE_VERSION, MIGRATION_OBJECT_ORDER, MigrationObjectType } from "../objectTypes";
import { createCurrentInstanceApi } from "../../zendesk/currentInstanceApi";

function objectsWith(overrides) {
  return MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
    objects[type] = overrides[type] || [];
    return objects;
  }, {});
}

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
});
