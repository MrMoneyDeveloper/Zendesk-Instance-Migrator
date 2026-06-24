import { MigrationObjectType, MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "../migration/objectTypes";
import TicketFilters from "./TicketFilters";

const SCOPE_SECTIONS = [
  {
    title: "Configuration",
    helper: "Core admin settings that define fields, forms, groups, macros, views, and custom object structure.",
    types: [
      MigrationObjectType.CUSTOM_OBJECTS,
      MigrationObjectType.CUSTOM_OBJECT_FIELDS,
      MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS,
      MigrationObjectType.GROUPS,
      MigrationObjectType.TICKET_FIELDS,
      MigrationObjectType.TICKET_FORMS,
      MigrationObjectType.MACROS,
      MigrationObjectType.VIEWS,
    ],
  },
  {
    title: "Help Center",
    helper: "Guide structure and article content for the selected help center scope.",
    types: [
      MigrationObjectType.HELP_CENTER_CATEGORIES,
      MigrationObjectType.HELP_CENTER_SECTIONS,
      MigrationObjectType.HELP_CENTER_ARTICLES,
    ],
  },
  {
    title: "Workflow & Routing",
    helper: "Rules and routing configuration that can change how tickets move through the instance.",
    types: [
      MigrationObjectType.WEBHOOKS,
      MigrationObjectType.TICKET_TRIGGERS,
      MigrationObjectType.AUTOMATIONS,
      MigrationObjectType.CUSTOM_OBJECT_TRIGGERS,
      MigrationObjectType.OMNICHANNEL_QUEUES,
      MigrationObjectType.ROUTING_SETTINGS,
    ],
  },
  {
    title: "Advanced / Large Export",
    helper: "Large or sensitive data exports. Use filters where available to keep bundles focused.",
    types: [MigrationObjectType.TICKETS],
  },
];

function getScopeSections() {
  const groupedTypes = new Set(SCOPE_SECTIONS.flatMap((section) => section.types));
  const fallbackTypes = MIGRATION_OBJECT_ORDER.filter((type) => !groupedTypes.has(type));
  return fallbackTypes.length > 0
    ? [
        ...SCOPE_SECTIONS,
        {
          title: "Other",
          helper: "Additional migration options from the current app version.",
          types: fallbackTypes,
        },
      ]
    : SCOPE_SECTIONS;
}

function scopeHelpText(type) {
  if (type === MigrationObjectType.ROUTING_SETTINGS) return "Experimental";
  if (type === MigrationObjectType.TICKETS) return "Large export";
  return "";
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function bundleSize(bundle) {
  if (!bundle) return 0;
  try {
    return new Blob([JSON.stringify(bundle)]).size;
  } catch {
    return JSON.stringify(bundle).length;
  }
}

function classifyLogEntry(entry) {
  const text = String(entry || "");
  const lower = text.toLowerCase();
  if (lower.includes("failed") || lower.includes("error") || lower.includes("could not")) return "Failed";
  if (lower.includes("exported") || lower.includes("complete") || lower.includes("download")) return "Completed";
  if (lower.includes("starting") || lower.includes("exporting")) return "Exporting";
  if (lower.includes("skipped")) return "Skipped";
  return "Info";
}

function logSummary(entry) {
  return String(entry || "").replace(/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?\s*/i, "").trim() || String(entry || "");
}

function logTime(entry) {
  const match = String(entry || "").match(/^(\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?)/i);
  return match?.[1] || "--";
}

export default function ExportPanel({
  startupState,
  scope,
  includeInactive,
  ticketExportOptions,
  ticketFilterOptions,
  onScopeChange,
  onIncludeInactiveChange,
  onTicketDateRangeChange,
  onTicketFiltersChange,
  onRunExport,
  exporting,
  logs,
  bundle,
  onDownloadBundle,
}) {
  const ticketFilters = ticketExportOptions?.ticketFilters || {};
  const selectedCount = MIGRATION_OBJECT_ORDER.filter((type) => Boolean(scope[type])).length;
  const totalCount = MIGRATION_OBJECT_ORDER.length;
  const visibleScopeSections = getScopeSections();
  const exportStatus = exporting ? "Exporting" : bundle ? "Completed" : logs.some((entry) => classifyLogEntry(entry) === "Failed") ? "Failed" : "Ready";
  const recentActivity = logs.slice(-3).reverse();
  const currentBundleSize = bundleSize(bundle);

  return (
    <section className="panel">
      <div className="export-dashboard">
        <div className="export-main-card">
          <div className="panel-header export-panel-header">
            <div>
              <h2>Export from current instance</h2>
              <p className="muted">Current instance detected: {startupState?.context?.subdomain || "Unavailable"}</p>
            </div>
            <div className="export-actions">
              <button type="button" className="secondary" onClick={onDownloadBundle} disabled={!bundle}>
                Download migration bundle
              </button>
              <button type="button" className="primary" onClick={onRunExport} disabled={exporting}>
                {exporting ? "Exporting" : "Run export"}
              </button>
            </div>
          </div>

          <div className="notice warning">Treat this bundle as confidential because it contains business rules and internal configuration.</div>

          <section className="flat-section export-scope-section">
            <div className="scope-heading">
              <div>
                <h3>Export scope</h3>
                <p className="muted">Choose the configuration and data areas to include in this migration bundle.</p>
              </div>
              <span className="scope-count">{selectedCount} of {totalCount} selected</span>
            </div>

            <div className="scope-section-grid">
              {visibleScopeSections.map((section) => (
                <section className="scope-card" key={section.title}>
                  <div className="scope-card-heading">
                    <h4>{section.title}</h4>
                    <p className="muted">{section.helper}</p>
                  </div>
                  <div className="check-grid scope-check-grid">
                    {section.types
                      .filter((type) => MIGRATION_OBJECT_ORDER.includes(type))
                      .map((type) => (
                        <label className="check-row" key={type}>
                          <input
                            type="checkbox"
                            checked={Boolean(scope[type])}
                            onChange={(event) => onScopeChange(type, event.target.checked)}
                          />
                          <span>
                            {MIGRATION_OBJECT_LABELS[type]}
                            {scopeHelpText(type) ? <small className="info-pill">{scopeHelpText(type)}</small> : null}
                          </span>
                        </label>
                      ))}
                  </div>
                </section>
              ))}
            </div>

            <label className="check-row standalone">
              <input type="checkbox" checked={includeInactive} onChange={(event) => onIncludeInactiveChange(event.target.checked)} />
              <span>Include inactive items</span>
            </label>

            {scope.tickets ? (
              <section className="flat-section ticket-range-card" id="zim-ticket-range-panel">
                <h3>Ticket migration range</h3>
                <div className="notice warning">A ticket date range is required to prevent accidental full ticket exports.</div>
                <div className="ticket-range-grid">
                  <label className="field-column">
                    <span>From</span>
                    <input
                      type="date"
                      value={ticketExportOptions?.ticketDateRange?.from || ""}
                      onChange={(event) => onTicketDateRangeChange("from", event.target.value)}
                    />
                  </label>
                  <label className="field-column">
                    <span>To</span>
                    <input
                      type="date"
                      value={ticketExportOptions?.ticketDateRange?.to || ""}
                      onChange={(event) => onTicketDateRangeChange("to", event.target.value)}
                    />
                  </label>
                </div>

                <TicketFilters filters={ticketFilters} options={ticketFilterOptions} onChange={onTicketFiltersChange} />
              </section>
            ) : null}
          </section>

          <section className="flat-section export-log-section">
            <div className="toolbar">
              <div>
                <h3>Export log</h3>
                <p className="muted">Recent export messages from this session.</p>
              </div>
            </div>
            {logs.length === 0 ? (
              <div className="log-empty" role="log" aria-live="polite">
                <p className="muted">No export activity yet.</p>
              </div>
            ) : (
              <div className="table-wrap export-log-table-wrap" role="log" aria-live="polite">
                <table className="export-log-table">
                  <thead>
                    <tr>
                      <th>Date &amp; time</th>
                      <th>Status</th>
                      <th>Summary</th>
                      <th>Bundle size</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((entry, index) => {
                      const status = classifyLogEntry(entry);
                      const isLatest = index === logs.length - 1;
                      return (
                        <tr key={`${entry}-${index}`}>
                          <td data-label="Date & time">{logTime(entry)}</td>
                          <td data-label="Status">
                            <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>
                          </td>
                          <td data-label="Summary">{logSummary(entry)}</td>
                          <td data-label="Bundle size">{isLatest && bundle ? formatBytes(currentBundleSize) : "--"}</td>
                          <td data-label="Actions">
                            {isLatest && bundle ? (
                              <button type="button" className="secondary compact-button" onClick={onDownloadBundle}>
                                Download
                              </button>
                            ) : (
                              "--"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="export-status-card" aria-label="Export status">
          <div className="status-card-header">
            <span className={`status-dot status-${exportStatus.toLowerCase()}`} />
            <div>
              <h3>Status: {exportStatus}</h3>
              <p className="muted">Export readiness for this session.</p>
            </div>
          </div>

          <dl className="details-list status-details">
            <dt>Last export</dt>
            <dd>{formatDateTime(bundle?.exported_at)}</dd>
            <dt>Bundle size</dt>
            <dd>{formatBytes(currentBundleSize)}</dd>
            <dt>Selected scope</dt>
            <dd>{selectedCount} of {totalCount}</dd>
          </dl>

          <div className="recent-activity">
            <h4>Recent activity</h4>
            {recentActivity.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <ul className="compact-list">
                {recentActivity.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{logSummary(entry)}</li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
