import { EXCLUDED_OBJECT_TYPES, MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "../migration/objectTypes";

const TICKET_CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "web", label: "Web form" },
  { value: "api", label: "API" },
  { value: "chat", label: "Chat" },
  { value: "messaging", label: "Messaging" },
  { value: "voice", label: "Talk / phone" },
  { value: "social", label: "Social" },
  { value: "sms", label: "SMS" },
  { value: "other", label: "Other / unknown" },
];

const TICKET_STATUS_OPTIONS = ["new", "open", "pending", "hold", "solved", "closed"];
const TICKET_TYPE_OPTIONS = ["question", "incident", "problem", "task"];
const TICKET_PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"];

const COMMENT_MODE_OPTIONS = [
  { value: "all", label: "All comment types" },
  { value: "public", label: "Has public replies" },
  { value: "internal", label: "Has internal notes" },
  { value: "both", label: "Has public replies and internal notes" },
];

function toggleListValue(values, value, selected) {
  const current = new Set((values || []).map(String));
  if (selected) current.add(value);
  else current.delete(value);
  return [...current];
}

function OptionCheckboxes({ title, options, values, onChange }) {
  return (
    <div className="ticket-filter-group">
      <h4>{title}</h4>
      <div className="ticket-filter-options">
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? option : option.label;
          return (
            <label className="check-row compact" key={value}>
              <input
                type="checkbox"
                checked={(values || []).includes(value)}
                onChange={(event) => onChange(toggleListValue(values, value, event.target.checked))}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function ExportPanel({
  startupState,
  scope,
  includeInactive,
  ticketExportOptions,
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

  function updateCustomFieldFilter(index, key, value) {
    const filters = [...(ticketFilters.customFieldFilters || [])];
    filters[index] = { ...(filters[index] || {}), [key]: value };
    onTicketFiltersChange({ customFieldFilters: filters });
  }

  function addCustomFieldFilter() {
    onTicketFiltersChange({
      customFieldFilters: [...(ticketFilters.customFieldFilters || []), { field: "", value: "" }],
    });
  }

  function removeCustomFieldFilter(index) {
    onTicketFiltersChange({
      customFieldFilters: (ticketFilters.customFieldFilters || []).filter((_, filterIndex) => filterIndex !== index),
    });
  }

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
                <span>
                  {MIGRATION_OBJECT_LABELS[type]}
                  {type === "routing_settings" ? " (Experimental / unsupported from current app context)" : ""}
                  {type === "tickets" ? " (Large export; users and attachments are not migrated)" : ""}
                </span>
              </label>
            ))}
          </div>
          <label className="check-row standalone">
            <input type="checkbox" checked={includeInactive} onChange={(event) => onIncludeInactiveChange(event.target.checked)} />
            <span>Include inactive items</span>
          </label>

          {scope.tickets ? (
            <section className="flat-section ticket-range-card">
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

              <section className="ticket-filter-card">
                <div>
                  <h3>Ticket filters</h3>
                  <p className="muted">Leave filters blank to include every ticket in the selected date range.</p>
                </div>

                <div className="ticket-filter-grid">
                  <OptionCheckboxes
                    title="Ticket channel"
                    options={TICKET_CHANNEL_OPTIONS}
                    values={ticketFilters.channels || []}
                    onChange={(channels) => onTicketFiltersChange({ channels })}
                  />
                  <OptionCheckboxes
                    title="Ticket status"
                    options={TICKET_STATUS_OPTIONS}
                    values={ticketFilters.statuses || []}
                    onChange={(statuses) => onTicketFiltersChange({ statuses })}
                  />
                  <OptionCheckboxes
                    title="Ticket type"
                    options={TICKET_TYPE_OPTIONS}
                    values={ticketFilters.types || []}
                    onChange={(types) => onTicketFiltersChange({ types })}
                  />
                  <OptionCheckboxes
                    title="Ticket priority"
                    options={TICKET_PRIORITY_OPTIONS}
                    values={ticketFilters.priorities || []}
                    onChange={(priorities) => onTicketFiltersChange({ priorities })}
                  />
                </div>

                <label className="field-column ticket-comment-mode">
                  <span>Comment type</span>
                  <select
                    value={ticketFilters.commentMode || "all"}
                    onChange={(event) => onTicketFiltersChange({ commentMode: event.target.value })}
                  >
                    {COMMENT_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <section className="ticket-custom-filters">
                  <div className="toolbar">
                    <div>
                      <h4>Custom ticket field filters</h4>
                      <p className="muted">Use a Zendesk custom field ID/key and exact value.</p>
                    </div>
                    <button type="button" className="secondary" onClick={addCustomFieldFilter}>
                      Add field filter
                    </button>
                  </div>
                  {(ticketFilters.customFieldFilters || []).length === 0 ? (
                    <p className="muted">No custom field filters added.</p>
                  ) : (
                    <div className="ticket-custom-filter-list">
                      {(ticketFilters.customFieldFilters || []).map((filter, index) => (
                        <div className="ticket-custom-filter-row" key={index}>
                          <label className="field-column">
                            <span>Field ID/key</span>
                            <input
                              type="text"
                              value={filter.field || ""}
                              onChange={(event) => updateCustomFieldFilter(index, "field", event.target.value)}
                              placeholder="custom field id"
                            />
                          </label>
                          <label className="field-column">
                            <span>Value</span>
                            <input
                              type="text"
                              value={filter.value || ""}
                              onChange={(event) => updateCustomFieldFilter(index, "value", event.target.value)}
                              placeholder="field value"
                            />
                          </label>
                          <button type="button" className="secondary" onClick={() => removeCustomFieldFilter(index)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>
            </section>
          ) : null}
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
