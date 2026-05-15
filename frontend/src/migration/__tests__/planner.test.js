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
});
