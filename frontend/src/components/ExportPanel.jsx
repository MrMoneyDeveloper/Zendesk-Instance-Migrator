import { EXCLUDED_OBJECT_TYPES, MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "../migration/objectTypes";

export default function ExportPanel({
  startupState,
  scope,
  includeInactive,
  onScopeChange,
  onIncludeInactiveChange,
  onRunExport,
  exporting,
  logs,
  bundle,
  onDownloadBundle,
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Export from current instance</h2>
          <p className="muted">Current instance detected: {startupState?.context?.subdomain || "Unavailable"}</p>
        </div>
        <button type="button" className="primary" onClick={onRunExport} disabled={exporting}>
          {exporting ? "Exporting" : "Run export"}
        </button>
      </div>

      <div className="notice warning">Treat this bundle as confidential because it contains business rules and internal configuration.</div>

      <div className="section-grid">
        <section className="flat-section">
          <h3>Export scope</h3>
          <div className="check-grid">
            {MIGRATION_OBJECT_ORDER.map((type) => (
              <label className="check-row" key={type}>
                <input
                  type="checkbox"
                  checked={Boolean(scope[type])}
                  onChange={(event) => onScopeChange(type, event.target.checked)}
                />
                <span>{MIGRATION_OBJECT_LABELS[type]}</span>
              </label>
            ))}
          </div>
          <label className="check-row standalone">
            <input type="checkbox" checked={includeInactive} onChange={(event) => onIncludeInactiveChange(event.target.checked)} />
            <span>Include inactive items</span>
          </label>
        </section>

        <section className="flat-section">
          <h3>Excluded</h3>
          <ul className="compact-list">
            {EXCLUDED_OBJECT_TYPES.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className="flat-section">
        <div className="toolbar">
          <h3>Export log</h3>
          <button type="button" className="secondary" onClick={onDownloadBundle} disabled={!bundle}>
            Download migration bundle
          </button>
        </div>
        <div className="log" role="log" aria-live="polite">
          {logs.length === 0 ? <p className="muted">No export activity yet.</p> : logs.map((entry) => <div key={entry}>{entry}</div>)}
        </div>
      </section>
    </section>
  );
}
