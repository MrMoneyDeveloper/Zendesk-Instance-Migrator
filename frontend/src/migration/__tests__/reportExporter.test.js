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

  it("redacts secret values from report artifacts", () => {
    const report = buildExecutionReport({
      plan: { plan_id: "plan-2" },
      bundle: { bundle_version: "1.0.0", source: { subdomain: "source" }, metadata: {} },
      target: { subdomain: "target" },
      startedAt: "2026-05-14T00:00:00.000Z",
      completedAt: "2026-05-14T00:01:00.000Z",
      results: [
        {
          object_type: "webhooks",
          display_name: "Notify",
          status: "created",
          payload: { authentication: { data: { password: "secret" } } },
        },
      ],
      logs: ["done"],
      apiErrors: [{ details: { token: "abc" } }],
      dependencyWarnings: [],
      webhookCredentialSupplied: true,
    });

    expect(report.webhook_summary.credential_supplied).toBe("yes");
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(JSON.stringify(report)).not.toContain("abc");
  });
});
