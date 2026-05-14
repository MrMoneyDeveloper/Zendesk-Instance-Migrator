const ACTION_LABELS = [
  ["create", "Create"],
  ["update", "Update"],
  ["skip", "Skip"],
  ["fail", "Fail"],
  ["manual_required", "Manual required"],
];

export default function DryRunSummary({ plan, confirmed, onConfirmChange, onExecute, executing }) {
  if (!plan) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Dry-run summary</h2>
          <p className="muted">Target instance: {plan.target?.subdomain || "current instance"}</p>
        </div>
        <button type="button" className="primary" onClick={onExecute} disabled={!confirmed || executing || plan.items.length === 0}>
          {executing ? "Executing import" : "Execute import"}
        </button>
      </div>

      <div className="summary-grid">
        {ACTION_LABELS.map(([key, label]) => (
          <div className="metric" key={key}>
            <span>{label}</span>
            <strong>{plan.summary?.[key] || 0}</strong>
          </div>
        ))}
      </div>

      {plan.warnings?.length > 0 ? (
        <section className="flat-section">
          <h3>Warnings</h3>
          <ul className="compact-list">
            {plan.warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flat-section">
        <h3>Review plan</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Action</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item, index) => (
                <tr key={`${item.object_type}-${item.source_key}-${index}`}>
                  <td>{item.object_type}</td>
                  <td>{item.display_name}</td>
                  <td>
                    <span className={`badge action-${item.action.toLowerCase()}`}>{item.action}</span>
                  </td>
                  <td>{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {plan.blocked?.length > 0 ? (
        <section className="flat-section">
          <h3>Blocked</h3>
          <ul className="compact-list">
            {plan.blocked.map((item, index) => (
              <li key={`${item.source_key}-${index}`}>{item.reason}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <label className="check-row confirm-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmChange(event.target.checked)} />
        <span>I understand this will modify the current Zendesk instance.</span>
      </label>
    </section>
  );
}
