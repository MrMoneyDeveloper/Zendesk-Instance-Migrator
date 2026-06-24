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
  if (selected) current.add(String(value));
  else current.delete(String(value));
  return [...current];
}

function selectedOptions(event) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function cleanTagInput(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeSelectItems(items, fallbackLabel = "Untitled") {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: String(item?.id ?? item?.value ?? ""),
      label: String(item?.name || item?.title || item?.email || item?.value || item?.id || fallbackLabel),
      email: item?.email || "",
    }))
    .filter((item) => item.value);
}

function normalizeTicketField(field) {
  const options = [...(field?.custom_field_options || []), ...(field?.system_field_options || [])]
    .map((option) => ({
      value: String(option?.value ?? option?.name ?? option?.id ?? ""),
      label: String(option?.name || option?.value || option?.id || "Untitled option"),
    }))
    .filter((option) => option.value);

  return {
    id: String(field?.id ?? ""),
    key: String(field?.key || ""),
    title: String(field?.title || field?.raw_title || field?.key || field?.id || "Untitled field"),
    type: String(field?.type || field?.field_type || "").toLowerCase(),
    options,
  };
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
                checked={(values || []).map(String).includes(String(value))}
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

function CheckboxListFilter({ label, values, items, onChange }) {
  const selectedCount = (values || []).length;

  return (
    <section className="ticket-filter-group ticket-checkbox-list-filter">
      <div className="ticket-filter-heading">
        <h4>{label}</h4>
        <span className="muted">Selected: {selectedCount}</span>
      </div>
      <div className="ticket-checkbox-list">
        {items.map((item) => (
          <label className="check-row compact" key={item.value}>
            <input
              type="checkbox"
              checked={(values || []).map(String).includes(String(item.value))}
              onChange={(event) => onChange(toggleListValue(values, item.value, event.target.checked))}
            />
            <span>{item.email ? `${item.label} <${item.email}>` : item.label}</span>
          </label>
        ))}
        {items.length === 0 ? <p className="muted">No options loaded.</p> : null}
      </div>
    </section>
  );
}

function CustomFieldValueInput({ filter, field, onChange }) {
  if (!field) {
    return (
      <input
        type="text"
        value={filter.value || ""}
        onChange={(event) => onChange({ value: event.target.value })}
        placeholder="Select a field first"
        disabled
      />
    );
  }

  if (["tagger", "dropdown", "multiselect", "multi_select"].includes(field.type) && field.options.length > 0) {
    const isMulti = ["multiselect", "multi_select"].includes(field.type);
    return (
      <select
        multiple={isMulti}
        value={isMulti ? (Array.isArray(filter.value) ? filter.value.map(String) : []) : String(filter.value || "")}
        onChange={(event) => onChange({ value: isMulti ? selectedOptions(event) : event.target.value })}
      >
        {!isMulti ? <option value="">Select value</option> : null}
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "checkbox") {
    return (
      <select value={String(filter.value ?? "")} onChange={(event) => onChange({ value: event.target.value })}>
        <option value="">Select value</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }

  const inputType = field.type === "date" ? "date" : ["decimal", "integer", "numeric", "number"].includes(field.type) ? "number" : "text";
  return (
    <input
      type={inputType}
      value={filter.value || ""}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder="Field value"
    />
  );
}

export default function TicketFilters({ filters = {}, options = {}, onChange }) {
  const brands = normalizeSelectItems(options.brands);
  const groups = normalizeSelectItems(options.groups);
  const ticketForms = normalizeSelectItems(options.ticketForms);
  const users = normalizeSelectItems(options.users);
  const organizations = normalizeSelectItems(options.organizations);
  const ticketFields = (options.ticketFields || []).map(normalizeTicketField).filter((field) => field.id);
  const customFieldFilters = filters.customFieldFilters || [];

  function updateCustomFieldFilter(index, patch) {
    const next = [...customFieldFilters];
    const previous = next[index] || {};
    const field = patch.field
      ? ticketFields.find((item) => item.id === String(patch.field))
      : ticketFields.find((item) => item.id === String(previous.field));
    next[index] = {
      ...previous,
      ...patch,
      title: field?.title || previous.title || "",
      key: field?.key || previous.key || "",
      type: field?.type || previous.type || "",
    };
    if (patch.field) next[index].value = "";
    onChange({ customFieldFilters: next });
  }

  function addCustomFieldFilter() {
    onChange({ customFieldFilters: [...customFieldFilters, { field: "", value: "" }] });
  }

  function removeCustomFieldFilter(index) {
    onChange({ customFieldFilters: customFieldFilters.filter((_, filterIndex) => filterIndex !== index) });
  }

  return (
    <section className="ticket-filter-card">
      <div>
        <h3>Ticket filters</h3>
        <p className="muted">Leave filters blank to include every ticket in the selected date range.</p>
        {options.loading ? <p className="muted">Loading ticket filter options.</p> : null}
        {options.error ? <div className="notice warning">{options.error}</div> : null}
      </div>

      <div className="ticket-filter-grid">
        <OptionCheckboxes title="Ticket channel" options={TICKET_CHANNEL_OPTIONS} values={filters.channels || []} onChange={(channels) => onChange({ channels })} />
        <OptionCheckboxes title="Ticket status" options={TICKET_STATUS_OPTIONS} values={filters.statuses || []} onChange={(statuses) => onChange({ statuses })} />
        <OptionCheckboxes title="Ticket type" options={TICKET_TYPE_OPTIONS} values={filters.types || []} onChange={(types) => onChange({ types })} />
        <OptionCheckboxes title="Ticket priority" options={TICKET_PRIORITY_OPTIONS} values={filters.priorities || []} onChange={(priorities) => onChange({ priorities })} />
      </div>

      <div className="ticket-filter-grid">
        <CheckboxListFilter label="Brand" values={filters.brandIds || []} items={brands} onChange={(brandIds) => onChange({ brandIds })} />
        <CheckboxListFilter label="Group" values={filters.groupIds || []} items={groups} onChange={(groupIds) => onChange({ groupIds })} />
        <CheckboxListFilter label="Assignee" values={filters.assigneeIds || []} items={users} onChange={(assigneeIds) => onChange({ assigneeIds })} />
        <CheckboxListFilter label="Requester" values={filters.requesterIds || []} items={users} onChange={(requesterIds) => onChange({ requesterIds })} />
        <CheckboxListFilter label="Organization" values={filters.organizationIds || []} items={organizations} onChange={(organizationIds) => onChange({ organizationIds })} />
        <CheckboxListFilter label="Ticket form" values={filters.ticketFormIds || []} items={ticketForms} onChange={(ticketFormIds) => onChange({ ticketFormIds })} />
      </div>

      <div className="ticket-filter-grid">
        <label className="field-column ticket-comment-mode">
          <span>Comment type</span>
          <select value={filters.commentMode || "all"} onChange={(event) => onChange({ commentMode: event.target.value })}>
            {COMMENT_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-column">
          <span>Tags</span>
          <input
            type="text"
            value={(filters.tags || []).join(", ")}
            onChange={(event) => onChange({ tags: cleanTagInput(event.target.value) })}
            placeholder="vip, billing, urgent"
          />
        </label>
      </div>

      <section className="ticket-custom-filters">
        <div className="toolbar">
          <div>
            <h4>Custom ticket field filters</h4>
            <p className="muted">Choose fields from this Zendesk instance and filter by their values.</p>
          </div>
          <button type="button" className="secondary" onClick={addCustomFieldFilter}>
            Add field filter
          </button>
        </div>
        {customFieldFilters.length === 0 ? (
          <p className="muted">No custom field filters added.</p>
        ) : (
          <div className="ticket-custom-filter-list">
            {customFieldFilters.map((filter, index) => {
              const field = ticketFields.find((item) => item.id === String(filter.field));
              return (
                <div className="ticket-custom-filter-row" key={index}>
                  <label className="field-column">
                    <span>Ticket field</span>
                    <select value={filter.field || ""} onChange={(event) => updateCustomFieldFilter(index, { field: event.target.value })}>
                      <option value="">Select field</option>
                      {ticketFields.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-column">
                    <span>Value</span>
                    <CustomFieldValueInput filter={filter} field={field} onChange={(patch) => updateCustomFieldFilter(index, patch)} />
                  </label>
                  <button type="button" className="secondary" onClick={() => removeCustomFieldFilter(index)}>
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
