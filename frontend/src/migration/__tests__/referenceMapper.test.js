import { describe, expect, it } from "vitest";

import { ReferenceMapper } from "../referenceMapper";
import { MigrationObjectType, MIGRATION_OBJECT_ORDER, BUNDLE_VERSION } from "../objectTypes";

function bundleWith(itemsByType) {
  return {
    bundle_version: BUNDLE_VERSION,
    source: {},
    scope: {},
    objects: MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
      objects[type] = itemsByType[type] || [];
      return objects;
    }, {}),
  };
}

describe("reference mapping", () => {
  it("rewrites field and group references to target ids", () => {
    const mapper = new ReferenceMapper(
      bundleWith({
        [MigrationObjectType.TICKET_FIELDS]: [{ metadata: { source_id: 12 }, payload: { key: "issue_type" } }],
        [MigrationObjectType.GROUPS]: [{ metadata: { source_id: 44 }, payload: { name: "Support" } }],
      }),
    );

    mapper.registerObjectResult(MigrationObjectType.TICKET_FIELDS, { metadata: { source_id: 12 }, payload: { key: "issue_type" } }, { id: 99 });
    mapper.registerObjectResult(MigrationObjectType.GROUPS, { metadata: { source_id: 44 }, payload: { name: "Support" } }, { id: 55 });

    const result = mapper.rewritePayload({
      ticket_field_ids: [12],
      conditions: {
        all: [{ field: "group_id", operator: "is", value: 44 }],
        any: [{ field: "ticket_field_12", operator: "is", value: "vip" }],
      },
    });

    expect(result.missing).toEqual([]);
    expect(result.payload.ticket_field_ids).toEqual([99]);
    expect(result.payload.conditions.all[0].value).toBe(55);
    expect(result.payload.conditions.any[0].field).toBe("ticket_field_99");
  });

  it("reports dependency references that are known but not mapped at execution time", () => {
    const mapper = new ReferenceMapper(
      bundleWith({
        [MigrationObjectType.TICKET_FIELDS]: [{ metadata: { source_id: 12 }, payload: { key: "issue_type" } }],
      }),
    );

    const result = mapper.rewritePayload({ ticket_field_ids: [12] });
    expect(result.missing[0]).toMatchObject({ type: "ticket_field", value: 12 });
  });

  it("maps notification_webhook id only and keeps webhook body untouched", () => {
    const mapper = new ReferenceMapper(
      bundleWith({
        [MigrationObjectType.WEBHOOKS]: [{ metadata: { source_id: "source-wh-1" }, payload: { name: "Ticket Updater" } }],
      }),
    );

    mapper.registerObjectResult(
      MigrationObjectType.WEBHOOKS,
      { metadata: { source_id: "source-wh-1" }, payload: { name: "Ticket Updater" } },
      { id: "target-wh-9" },
    );

    const payload = {
      actions: [
        {
          field: "notification_webhook",
          value: [
            "source-wh-1",
            '{ "ticket": { "comment": { "body":"Reopened", "public": false } } }',
          ],
        },
      ],
    };

    const refs = mapper.collectReferences(payload);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: "webhook", value: "source-wh-1", label: "notification_webhook.id" });

    const rewritten = mapper.rewritePayload(payload);
    expect(rewritten.missing).toEqual([]);
    expect(rewritten.payload.actions[0].value[0]).toBe("target-wh-9");
    expect(rewritten.payload.actions[0].value[1]).toBe('{ "ticket": { "comment": { "body":"Reopened", "public": false } } }');
  });
});
