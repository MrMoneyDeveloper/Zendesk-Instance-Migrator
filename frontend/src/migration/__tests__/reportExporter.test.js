import { describe, expect, it } from "vitest";

import { buildExecutionReport, reportToCsv } from "../reportExporter";

describe("report export", () => {
  it("builds JSON report details and CSV summary", () => {
    const report = buildExecutionReport({
      plan: { plan_id: "plan-1" },
      bundle: { bundle_version: "1.0.0", source: { subdomain: "source" }, metadata: {} },
      target: { subdomain: "target" },
      startedAt: "2026-05-14T00:00:00.000Z",
      completedAt: "2026-05-14T00:01:00.000Z",
      results: [
        { object_type: "groups", display_name: "Support", status: "created" },
        { object_type: "webhooks", display_name: "Notify CRM", status: "manual_required" },
      ],
      logs: [],
      apiErrors: [],
      dependencyWarnings: [],
    });

    expect(report.created_items).toHaveLength(1);
    expect(report.manual_required_items).toHaveLength(1);
    expect(reportToCsv(report)).toContain("Groups,1,0,0,0,0");
  });
});
