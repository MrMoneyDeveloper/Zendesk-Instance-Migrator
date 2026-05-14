import { describe, expect, it } from "vitest";

import { validateBundle } from "../bundleValidator";
import { BUNDLE_VERSION, MIGRATION_OBJECT_ORDER } from "../objectTypes";

function emptyObjects() {
  return MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
    objects[type] = [];
    return objects;
  }, {});
}

describe("bundle validation", () => {
  it("accepts a versioned migration bundle", () => {
    const result = validateBundle({
      bundle_version: BUNDLE_VERSION,
      app_name: "Instance Config Migrator",
      exported_at: "2026-05-14T00:00:00.000Z",
      source: { subdomain: "source" },
      scope: {},
      objects: emptyObjects(),
      metadata: { counts: {}, warnings: [], unsupported: [], skipped: [] },
    });

    expect(result.valid).toBe(true);
    expect(result.summary.counts.groups).toBe(0);
  });

  it("rejects unsupported bundle versions", () => {
    const result = validateBundle({
      bundle_version: "9.0.0",
      source: {},
      scope: {},
      objects: emptyObjects(),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unsupported migration bundle version");
  });
});
