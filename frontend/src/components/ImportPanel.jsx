import { MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "../migration/objectTypes";

export default function ImportPanel({
  fileName,
  validation,
  bundleSummary,
  options,
  helpCenterDestinationOptions,
  ticketImportOptions,
  fullTicketSetup,
  importSteps,
  onFileChange,
  onValidate,
  onOptionChange,
  onTicketImportDateRangeChange,
  onFullTicketSetupChange,
  onDryRun,
  dryRunRunning,
}) {
  const ticketCount = Number(bundleSummary?.counts?.tickets || 0);
  const helpCenterCount =
    Number(bundleSummary?.counts?.help_center_categories || 0) +
    Number(bundleSummary?.counts?.help_center_sections || 0) +
    Number(bundleSummary?.counts?.help_center_articles || 0);
  const brands = Array.isArray(helpCenterDestinationOptions?.brands) ? helpCenterDestinationOptions.brands : [];

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

      {Array.isArray(importSteps) && importSteps.length > 0 ? (
        <ol className="import-stepper" aria-label="Import workflow steps">
          {importSteps.map((step, index) => (
            <li
              key={step.label}
              className={[
                "import-step",
                step.complete ? "complete" : "",
                step.active ? "active" : "",
              ].filter(Boolean).join(" ")}
            >
              <span className="import-step-number">{index + 1}</span>
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="upload-workspace">
        <label
          className="upload-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            onFileChange(event.dataTransfer.files?.[0] || null);
          }}
        >
          <input
            className="visually-hidden-file"
            type="file"
            accept="application/json,.json"
            onChange={(event) => onFileChange(event.target.files?.[0] || null)}
          />
          <span className="upload-dropzone-icon">JSON</span>
          <strong>Drag & drop migration bundle (.json)</strong>
          <span className="muted">or choose a file from your computer</span>
          <span className="upload-dropzone-button">Choose file</span>
        </label>

        <div className="selected-file-card">
          <span className="muted">Selected file</span>
          <strong>{fileName || "No file selected"}</strong>
          <button type="button" className="secondary" onClick={onValidate} disabled={!fileName}>
            Validate bundle
          </button>
        </div>
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
            <input
              type="checkbox"
              checked={options.fullTicketMigration}
              onChange={(event) => onOptionChange("fullTicketMigration", event.target.checked)}
              disabled={ticketCount === 0}
            />
            <span>Full ticket migration</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.fullTicketAutoCreate}
              onChange={(event) => onOptionChange("fullTicketAutoCreate", event.target.checked)}
              disabled={!options.fullTicketMigration}
            />
            <span>Create missing users/orgs</span>
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

      {helpCenterCount > 0 ? (
        <section className="flat-section">
          <h3>Help Center destination</h3>
          <p className="muted">
            No Help Center URL is required. The app imports into this Zendesk instance and uses category/section names to resolve the hierarchy.
          </p>
          {helpCenterDestinationOptions?.error ? <div className="notice warning">{helpCenterDestinationOptions.error}</div> : null}
          <label className="field-column">
            <span>Target brand / Help Center</span>
            <select
              value={options.helpCenterTargetBrandId || ""}
              onChange={(event) => onOptionChange("helpCenterTargetBrandId", event.target.value)}
              disabled={helpCenterDestinationOptions?.loading || brands.length <= 1}
            >
              <option value="">Current instance default Help Center</option>
              {brands.map((brand) => (
                <option key={brand.id || brand.name} value={brand.id || ""}>
                  {brand.name || `Brand ${brand.id}`}
                </option>
              ))}
            </select>
          </label>
          {brands.length <= 1 && !helpCenterDestinationOptions?.loading ? (
            <p className="muted">Only one target Help Center was detected, so the default destination will be used.</p>
          ) : null}
        </section>
      ) : null}

      {ticketCount > 0 ? (
        <section className="flat-section ticket-range-card">
          <h3>Ticket import range</h3>
          <div className="notice warning">A ticket import date range is required before importing tickets.</div>
          <div className="ticket-range-grid">
            <label className="field-column">
              <span>From</span>
              <input
                type="date"
                value={ticketImportOptions?.ticketDateRange?.from || ""}
                onChange={(event) => onTicketImportDateRangeChange("from", event.target.value)}
              />
            </label>
            <label className="field-column">
              <span>To</span>
              <input
                type="date"
                value={ticketImportOptions?.ticketDateRange?.to || ""}
                onChange={(event) => onTicketImportDateRangeChange("to", event.target.value)}
              />
            </label>
          </div>
        </section>
      ) : null}

      {options.fullTicketMigration ? (
        <section className="flat-section">
          <h3>Full ticket migration</h3>
          <p className="muted">
            Source credentials are used only during this import run to read source users, organizations, and attachment files.
          </p>
          <div className="section-grid">
            <label className="field-column">
              <span>Source Zendesk subdomain</span>
              <input
                type="text"
                value={fullTicketSetup?.sourceSubdomain || ""}
                onChange={(event) => onFullTicketSetupChange("sourceSubdomain", event.target.value)}
                placeholder="cxsupporthub"
              />
            </label>
            <label className="field-column">
              <span>Source API email</span>
              <input
                type="email"
                value={fullTicketSetup?.email || ""}
                onChange={(event) => onFullTicketSetupChange("email", event.target.value)}
              />
            </label>
            <label className="field-column">
              <span>Source API token</span>
              <input
                type="password"
                value={fullTicketSetup?.apiToken || ""}
                onChange={(event) => onFullTicketSetupChange("apiToken", event.target.value)}
              />
            </label>
          </div>
        </section>
      ) : null}
    </section>
  );
}
