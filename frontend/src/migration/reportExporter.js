import { downloadFile, timestampedFilename } from "../utils/downloadFile";
import { MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "./objectTypes";

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildExecutionReport({ plan, bundle, target, startedAt, completedAt, results, logs, apiErrors, dependencyWarnings }) {
  const countsByObjectType = MIGRATION_OBJECT_ORDER.reduce((counts, type) => {
    counts[type] = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      manual_required: 0,
    };
    return counts;
  }, {});

  for (const result of results) {
    const typeCounts = countsByObjectType[result.object_type] || {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      manual_required: 0,
    };

    if (result.status === "created") typeCounts.created += 1;
    if (result.status === "updated") typeCounts.updated += 1;
    if (result.status === "skipped") typeCounts.skipped += 1;
    if (result.status === "failed") typeCounts.failed += 1;
    if (result.status === "manual_required") typeCounts.manual_required += 1;
    countsByObjectType[result.object_type] = typeCounts;
  }

  return {
    target_instance: target,
    source_bundle: {
      bundle_version: bundle?.bundle_version,
      exported_at: bundle?.exported_at,
      source: bundle?.source,
      metadata: bundle?.metadata,
    },
    plan_id: plan?.plan_id,
    started_at: startedAt,
    completed_at: completedAt,
    counts_by_object_type: countsByObjectType,
    created_items: results.filter((item) => item.status === "created"),
    updated_items: results.filter((item) => item.status === "updated"),
    skipped_items: results.filter((item) => item.status === "skipped"),
    failed_items: results.filter((item) => item.status === "failed"),
    manual_required_items: results.filter((item) => item.status === "manual_required"),
    api_errors: apiErrors,
    dependency_warnings: dependencyWarnings,
    logs,
  };
}

export function reportToCsv(report) {
  const rows = [["Object type", "Created", "Updated", "Skipped", "Failed", "Manual required"]];

  for (const type of MIGRATION_OBJECT_ORDER) {
    const counts = report.counts_by_object_type?.[type] || {};
    rows.push([
      MIGRATION_OBJECT_LABELS[type] || type,
      counts.created || 0,
      counts.updated || 0,
      counts.skipped || 0,
      counts.failed || 0,
      counts.manual_required || 0,
    ]);
  }

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function downloadReportJson(report) {
  downloadFile({
    filename: timestampedFilename("migration-report", "json"),
    content: JSON.stringify(report, null, 2),
    mimeType: "application/json",
  });
}

export function downloadReportCsv(report) {
  downloadFile({
    filename: timestampedFilename("migration-report-summary", "csv"),
    content: reportToCsv(report),
    mimeType: "text/csv",
  });
}
