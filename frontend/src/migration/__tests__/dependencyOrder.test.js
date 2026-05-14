import { describe, expect, it } from "vitest";

import { orderObjectTypes, orderPlanItems } from "../dependencyOrder";
import { MigrationObjectType } from "../objectTypes";

describe("dependency order", () => {
  it("orders object types by dependency-safe import order", () => {
    expect(
      orderObjectTypes([
        MigrationObjectType.AUTOMATIONS,
        MigrationObjectType.TICKET_FORMS,
        MigrationObjectType.TICKET_FIELDS,
        MigrationObjectType.CUSTOM_OBJECTS,
      ]),
    ).toEqual([
      MigrationObjectType.CUSTOM_OBJECTS,
      MigrationObjectType.TICKET_FIELDS,
      MigrationObjectType.TICKET_FORMS,
      MigrationObjectType.AUTOMATIONS,
    ]);
  });

  it("orders plan items by type then stored order", () => {
    const ordered = orderPlanItems([
      { object_type: MigrationObjectType.TICKET_TRIGGERS, order: 2 },
      { object_type: MigrationObjectType.GROUPS, order: 5 },
      { object_type: MigrationObjectType.TICKET_TRIGGERS, order: 1 },
    ]);

    expect(ordered.map((item) => `${item.object_type}:${item.order}`)).toEqual(["groups:5", "ticket_triggers:1", "ticket_triggers:2"]);
  });
});
