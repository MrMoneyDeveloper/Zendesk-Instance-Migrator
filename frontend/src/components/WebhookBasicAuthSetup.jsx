export default function WebhookBasicAuthSetup({
  required,
  targetEmail,
  apiToken,
  onTargetEmailChange,
  onApiTokenChange,
  targetSubdomain,
  webhooks,
  dependentTriggers,
  dependentAutomations,
  endpointOverrides,
  onEndpointOverrideChange,
}) {
  if (!required) return null;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Webhook Basic Auth Setup</h2>
          <p className="muted">Required because this bundle contains webhooks and/or webhook-dependent rules.</p>
        </div>
      </div>

      <div className="notice warning">
        This token will only be used to create webhook Basic Auth credentials in the target instance. It will not be stored in the bundle,
        browser storage, logs, or reports.
      </div>

      <section className="flat-section">
        <div className="check-grid">
          <label className="field-column">
            <span>Zendesk API email</span>
            <input type="email" value={targetEmail} onChange={(event) => onTargetEmailChange(event.target.value)} placeholder="admin@example.com" />
          </label>
          <label className="field-column">
            <span>Zendesk API token</span>
            <input type="password" value={apiToken} onChange={(event) => onApiTokenChange(event.target.value)} placeholder="Enter API token" />
          </label>
        </div>
      </section>

      <section className="flat-section">
        <h3>Webhook summary</h3>
        <p className="muted">
          Webhooks found: {webhooks.length}; dependent triggers: {dependentTriggers.length}; dependent automations: {dependentAutomations.length}.
          Target subdomain: {targetSubdomain || "unknown"}.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Source endpoint</th>
                <th>Rewritten endpoint</th>
                <th>Optional override</th>
                <th>Warning</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => (
                <tr key={webhook.key}>
                  <td>{webhook.name}</td>
                  <td>{webhook.sourceEndpoint || "-"}</td>
                  <td>{webhook.rewrittenEndpoint || "-"}</td>
                  <td>
                    <input
                      type="text"
                      value={endpointOverrides?.[webhook.key] || ""}
                      onChange={(event) => onEndpointOverrideChange(webhook.key, event.target.value)}
                      placeholder="Optional manual endpoint override"
                    />
                  </td>
                  <td>{webhook.warning || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dependentTriggers.length > 0 || dependentAutomations.length > 0 ? (
        <section className="flat-section">
          <h3>Webhook-dependent rules</h3>
          {dependentTriggers.length > 0 ? (
            <>
              <p className="muted">Triggers</p>
              <ul className="compact-list">
                {dependentTriggers.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            </>
          ) : null}
          {dependentAutomations.length > 0 ? (
            <>
              <p className="muted">Automations</p>
              <ul className="compact-list">
                {dependentAutomations.map((entry, index) => (
                  <li key={`${entry}-${index}`}>{entry}</li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
