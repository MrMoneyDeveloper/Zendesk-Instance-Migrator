import { MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "../migration/objectTypes";

export default function ImportPanel({
  fileName,
  validation,
  bundleSummary,
  options,
  onFileChange,
  onValidate,
  onOptionChange,
  onDryRun,
  dryRunRunning,
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Import into current instance</h2>
          <p className="muted">Dry-run is mandatory before any import writes are enabled.</p>
        </div>
        <button type="button" className="primary" onClick={onDryRun} disabled={!validation.valid || dryRunRunning}>
          {dryRunRunning ? "Running dry-run" : "Run dry-run"}
        </button>
      </div>

      <div className="upload-row">
        <label className="file-input">
          <span>Upload migration bundle</span>
          <input type="file" accept="application/json,.json" onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
        </label>
        <button type="button" className="secondary" onClick={onValidate} disabled={!fileName}>
          Validate bundle
        </button>
        <span className="muted">{fileName || "No file selected"}</span>
      </div>

      {validation.message ? (
        <div className={validation.valid ? "notice success" : "notice error"}>{validation.message}</div>
      ) : null}

      {bundleSummary ? (
        <div className="section-grid">
          <section className="flat-section">
            <h3>Bundle summary</h3>
            <dl className="details-list">
              <dt>Source</dt>
              <dd>{bundleSummary.source?.subdomain || "Unknown"}</dd>
              <dt>Exported</dt>
              <dd>{bundleSummary.exported_at || "Unknown"}</dd>
            </dl>
          </section>

          <section className="flat-section">
            <h3>Object counts</h3>
            <div className="count-grid">
              {MIGRATION_OBJECT_ORDER.map((type) => (
                <div key={type} className="count-row">
                  <span>{MIGRATION_OBJECT_LABELS[type]}</span>
                  <strong>{bundleSummary.counts?.[type] || 0}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      <section className="flat-section">
        <h3>Import options</h3>
        <div className="check-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.overwriteExisting}
              onChange={(event) => onOptionChange("overwriteExisting", event.target.checked)}
            />
            <span>Overwrite existing matches</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={options.createOnly} onChange={(event) => onOptionChange("createOnly", event.target.checked)} />
            <span>Create only</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.includeInactive}
              onChange={(event) => onOptionChange("includeInactive", event.target.checked)}
            />
            <span>Include inactive</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.continueOnError}
              onChange={(event) => onOptionChange("continueOnError", event.target.checked)}
            />
            <span>Continue on error</span>
          </label>
          <label className="check-row">
            <span>Webhook dependency policy</span>
            <select
              value={options.webhookDependencyPolicy || "manual_required"}
              onChange={(event) => onOptionChange("webhookDependencyPolicy", event.target.value)}
            >
              <option value="manual_required">Manual required</option>
              <option value="inactive">Import dependent rules inactive</option>
              <option value="skip">Skip dependent rules</option>
            </select>
          </label>
        </div>
        <label className="file-input">
          <span>Webhook source-to-target mapping JSON (optional)</span>
          <textarea
            rows={4}
            placeholder='{"sourceWebhookNameOrId":"targetWebhookId"}'
            value={options.webhookMappingText || ""}
            onChange={(event) => onOptionChange("webhookMappingText", event.target.value)}
          />
        </label>
      </section>
    </section>
  );
}
