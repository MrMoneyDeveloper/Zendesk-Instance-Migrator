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
});
