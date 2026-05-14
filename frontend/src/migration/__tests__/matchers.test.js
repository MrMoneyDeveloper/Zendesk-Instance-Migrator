import { describe, expect, it } from "vitest";

import { findMatch } from "../matchers";
import { MigrationObjectType } from "../objectTypes";

describe("matching logic", () => {
  it("matches groups by name", () => {
    const match = findMatch(
      MigrationObjectType.GROUPS,
      { payload: { name: "VIP Support" } },
      [{ id: 1, name: "vip support" }],
    );

    expect(match.id).toBe(1);
  });

  it("matches ticket fields by key before title/type fallback", () => {
    const byKey = findMatch(
      MigrationObjectType.TICKET_FIELDS,
      { payload: { key: "customer_type", title: "Customer Type", type: "tagger" } },
      [{ id: 99, key: "customer_type", title: "Renamed", type: "tagger" }],
    );

    const fallback = findMatch(
      MigrationObjectType.TICKET_FIELDS,
      { payload: { title: "Issue Type", type: "tagger" } },
      [{ id: 100, title: "Issue Type", type: "tagger" }],
    );

    expect(byKey.id).toBe(99);
    expect(fallback.id).toBe(100);
  });

  it("matches webhooks by name and endpoint", () => {
    const match = findMatch(
      MigrationObjectType.WEBHOOKS,
      { payload: { name: "Notify CRM", endpoint: "https://example.test/hook" } },
      [{ id: "abc", name: "Notify CRM", endpoint: "https://example.test/hook" }],
    );

    expect(match.id).toBe("abc");
  });
});
