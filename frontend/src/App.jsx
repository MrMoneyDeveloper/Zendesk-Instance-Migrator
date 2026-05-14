import { useEffect, useMemo, useState } from "react";

import { MIGRATION_OBJECT_LABELS, MIGRATION_OBJECT_ORDER } from "./migration/objectTypes";
import { downloadRunReport } from "./migration/report";
import { createRunnerMigratorApi } from "./zendesk/runnerMigratorApi";

import "./App.css";

const RUNNER_START_COMMAND = "cd backend; python -m app.main";

function statusClass(status) {
  if (status === "success") return "status status-success";
  if (status === "error") return "status status-error";
  if (status === "validating" || status === "running") return "status status-running";
  return "status status-idle";
}

function CredentialForm({ title, value, onChange, validation, disabled }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <label htmlFor={`${title}-instance`}>Zendesk instance domain or URL</label>
      <input
        id={`${title}-instance`}
        type="text"
        placeholder="example.zendesk.com or subdomain"
        value={value.instance}
        onChange={(event) => onChange({ ...value, instance: event.target.value })}
        disabled={disabled}
      />

      <label htmlFor={`${title}-email`}>Admin email</label>
      <input
        id={`${title}-email`}
        type="email"
        placeholder="admin@example.com"
        value={value.email}
        onChange={(event) => onChange({ ...value, email: event.target.value })}
        disabled={disabled}
      />

      <label htmlFor={`${title}-token`}>API token</label>
      <input
        id={`${title}-token`}
        type="password"
        placeholder="Zendesk API token"
        value={value.apiToken}
        onChange={(event) => onChange({ ...value, apiToken: event.target.value })}
        disabled={disabled}
      />

      <div className="row">
        <span className={statusClass(validation.status)}>{validation.message}</span>
      </div>
    </section>
  );
}

function planSummaryRows(summaryByType) {
  if (!summaryByType) return [];
  return MIGRATION_OBJECT_ORDER.map((type) => {
    const summary = summaryByType[type] || { create: 0, update: 0, skip: 0 };
    return {
      type,
      label: MIGRATION_OBJECT_LABELS[type] || type,
      ...summary,
      total: summary.create + summary.update + summary.skip,
    };
  });
}

function resolveRunnerMessage(health, hasSessionToken) {
  const runner = health?.runner || {};
  const state = String(runner.state || "unknown");

  if (state === "awaiting_approval") {
    return "Runner online. Start with PIN approval from the local runner console.";
  }

  if (state === "approved") {
    if (hasSessionToken) {
      return "Runner approved. Continue with credential validation and dry-run.";
    }
    return "Runner was approved in another browser session. Restart runner to get a new PIN.";
  }

  if (state === "running") {
    return "Runner is currently executing a migration.";
  }

  if (state === "shutdown_requested" || state === "completed" || state === "failed") {
    return "Runner is shutting down or finished. Restart it for the next migration run.";
  }

  return `Runner online (${state}).`;
}

function App() {
  const api = useMemo(() => createRunnerMigratorApi(), []);

  const [sourceForm, setSourceForm] = useState({ instance: "", email: "", apiToken: "" });
  const [targetForm, setTargetForm] = useState({ instance: "", email: "", apiToken: "" });

  const [runnerState, setRunnerState] = useState({
    status: "idle",
    message: "Runner not checked.",
    online: false,
    health: null,
  });

  const [pin, setPin] = useState("");
  const [sessionState, setSessionState] = useState({
    status: "idle",
    message: "Session not approved.",
    token: "",
    expiresAt: "",
  });

  const [sourceValidation, setSourceValidation] = useState({ status: "idle", message: "Not validated" });
  const [targetValidation, setTargetValidation] = useState({ status: "idle", message: "Not validated" });

  const [dryRunState, setDryRunState] = useState({
    status: "idle",
    message: "Dry-run not started",
    runId: null,
    planId: null,
    summaryByType: null,
    totals: null,
    notes: [],
  });

  const [runState, setRunState] = useState({
    status: "idle",
    message: "Execution not started",
    runId: null,
    result: null,
    logs: [],
    report: null,
  });

  const sourceComplete = api.isCredentialComplete(sourceForm);
  const targetComplete = api.isCredentialComplete(targetForm);
  const sessionApproved = sessionState.status === "success" && Boolean(sessionState.token);

  const canValidate = runnerState.online && sessionApproved && sourceComplete && targetComplete;
  const canDryRun = runnerState.online && sessionApproved && sourceValidation.status === "success" && targetValidation.status === "success";
  const canExecute = runnerState.online && sessionApproved && Boolean(dryRunState.planId);

  const summaryRows = useMemo(() => planSummaryRows(dryRunState.summaryByType), [dryRunState.summaryByType]);

  useEffect(() => {
    void refreshRunnerStatus();
  }, []);

  async function refreshRunnerStatus(hasSessionTokenOverride = sessionApproved) {
    setRunnerState((previous) => ({
      ...previous,
      status: "running",
      message: "Checking local runner...",
    }));

    try {
      const health = await api.health();
      const state = String(health?.runner?.state || "unknown");
      const unavailableState = state === "shutdown_requested" || state === "completed" || state === "failed";
      const online = !unavailableState;

      setRunnerState({
        status: "success",
        message: resolveRunnerMessage(health, hasSessionTokenOverride),
        online,
        health,
      });

      if (!online) {
        setSessionState((previous) => ({
          ...previous,
          status: "idle",
          message: "Runner needs restart before approval.",
          token: "",
          expiresAt: "",
        }));
      }
    } catch (error) {
      setRunnerState({
        status: "error",
        message: `Runner offline. Start it locally: ${RUNNER_START_COMMAND}`,
        online: false,
        health: null,
      });
      setSessionState((previous) => ({
        ...previous,
        status: "idle",
        message: "Session not approved.",
        token: "",
        expiresAt: "",
      }));
    }
  }

  async function approveRunnerSession() {
    const cleanedPin = String(pin || "").trim();
    if (!runnerState.online) {
      setSessionState({
        status: "error",
        message: "Runner is offline. Start runner first.",
        token: "",
        expiresAt: "",
      });
      return;
    }

    if (!cleanedPin) {
      setSessionState((previous) => ({
        ...previous,
        status: "error",
        message: "Enter the one-time PIN from the runner console.",
      }));
      return;
    }

    setSessionState((previous) => ({
      ...previous,
      status: "running",
      message: "Approving session...",
    }));

    try {
      const result = await api.approveSession(cleanedPin);
      setSessionState({
        status: "success",
        message: "Session approved. Continue with credential validation.",
        token: String(result?.sessionToken || ""),
        expiresAt: String(result?.expiresAt || ""),
      });
      setPin("");
      await refreshRunnerStatus(true);
    } catch (error) {
      setSessionState({
        status: "error",
        message: error?.message || "Session approval failed.",
        token: "",
        expiresAt: "",
      });
    }
  }

  async function runValidation() {
    if (!canValidate) {
      setSourceValidation({ status: "error", message: "Enter complete source credentials and approve runner session." });
      setTargetValidation({ status: "error", message: "Enter complete target credentials and approve runner session." });
      return;
    }

    setSourceValidation({ status: "validating", message: "Validating..." });
    setTargetValidation({ status: "validating", message: "Validating..." });

    try {
      const result = await api.validate({
        sourceForm,
        targetForm,
        sessionToken: sessionState.token,
      });

      if (result?.source?.ok) {
        setSourceValidation({ status: "success", message: `Validated as ${result.source.authenticated_user || "user"}` });
      } else {
        setSourceValidation({ status: "error", message: result?.source?.detail || "Source validation failed." });
      }

      if (result?.target?.ok) {
        setTargetValidation({ status: "success", message: `Validated as ${result.target.authenticated_user || "user"}` });
      } else {
        setTargetValidation({ status: "error", message: result?.target?.detail || "Target validation failed." });
      }
    } catch (error) {
      const message = error?.message || "Validation failed.";
      setSourceValidation({ status: "error", message });
      setTargetValidation({ status: "error", message });
    }
  }

  async function runDryRun() {
    if (!canDryRun) {
      setDryRunState((previous) => ({
        ...previous,
        status: "error",
        message: "Validate source and target credentials before dry-run.",
      }));
      return;
    }

    setDryRunState({
      status: "running",
      message: "Running dry-run...",
      runId: null,
      planId: null,
      summaryByType: null,
      totals: null,
      notes: [],
    });

    setRunState({
      status: "idle",
      message: "Execution not started",
      runId: null,
      result: null,
      logs: [],
      report: null,
    });

    try {
      const result = await api.dryRun({
        sourceForm,
        targetForm,
        sessionToken: sessionState.token,
      });

      setDryRunState({
        status: "success",
        message: `Dry-run complete. Create ${result.totals.create}, update ${result.totals.update}, skip ${result.totals.skip}.`,
        runId: result.run_id,
        planId: result.plan_id,
        summaryByType: result.summary_by_type,
        totals: result.totals,
        notes: result.notes || [],
      });
    } catch (error) {
      setDryRunState({
        status: "error",
        message: error?.message || "Dry-run failed.",
        runId: null,
        planId: null,
        summaryByType: null,
        totals: null,
        notes: [],
      });
    }
  }

  async function runMigration() {
    if (!dryRunState.planId) {
      setRunState((previous) => ({ ...previous, status: "error", message: "Run dry-run first." }));
      return;
    }

    setRunState({
      status: "running",
      message: "Executing migration...",
      runId: null,
      result: null,
      logs: [],
      report: null,
    });

    try {
      const finalStatus = await api.execute({
        sourceForm,
        targetForm,
        planId: dryRunState.planId,
        sessionToken: sessionState.token,
      });

      const resultSummary = finalStatus.summary || {};
      const logs = Array.isArray(finalStatus.logs)
        ? finalStatus.logs.map((entry) => {
          if (entry?.message) return String(entry.message);
          if (entry?.type) {
            const objectType = entry.object_type || "";
            const sourceKey = entry.source_key || "";
            return `${entry.type}: ${objectType} ${sourceKey}`.trim();
          }
          return JSON.stringify(entry);
        })
        : [];

      const report = {
        executedAt: new Date().toISOString(),
        dryRun: {
          runId: dryRunState.runId,
          planId: dryRunState.planId,
          totals: dryRunState.totals,
          summaryByType: dryRunState.summaryByType,
          notes: dryRunState.notes,
        },
        execute: finalStatus,
      };

      setRunState({
        status: finalStatus.status === "completed" ? "success" : "error",
        message: finalStatus.status === "completed" ? "Migration completed." : "Migration finished with failures.",
        runId: finalStatus.id || null,
        result: resultSummary,
        logs,
        report,
      });

      setSessionState((previous) => ({
        ...previous,
        status: "idle",
        message: "Run finished. Runner will close; restart runner for next migration.",
        token: "",
        expiresAt: "",
      }));

      await refreshRunnerStatus();
    } catch (error) {
      setRunState({
        status: "error",
        message: error?.message || "Execution failed.",
        runId: null,
        result: null,
        logs: [],
        report: null,
      });
    }
  }

  function clearSession() {
    setSourceForm({ instance: "", email: "", apiToken: "" });
    setTargetForm({ instance: "", email: "", apiToken: "" });
    setSourceValidation({ status: "idle", message: "Not validated" });
    setTargetValidation({ status: "idle", message: "Not validated" });
    setDryRunState({
      status: "idle",
      message: "Dry-run not started",
      runId: null,
      planId: null,
      summaryByType: null,
      totals: null,
      notes: [],
    });
    setRunState({
      status: "idle",
      message: "Execution not started",
      runId: null,
      result: null,
      logs: [],
      report: null,
    });
    setPin("");
    setSessionState({
      status: "idle",
      message: "Session not approved.",
      token: "",
      expiresAt: "",
    });
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Instance Config Migrator</h1>
          <p>Zendesk app + ephemeral local runner for cross-instance configuration and routing migration.</p>
        </div>
        <button type="button" className="secondary" onClick={clearSession}>
          Reset
        </button>
      </header>

      <ol className="steps">
        <li className={runnerState.online ? "active" : ""}>1. Runner online</li>
        <li className={sessionApproved ? "active" : ""}>2. Session approved</li>
        <li className={sourceValidation.status === "success" && targetValidation.status === "success" ? "active" : ""}>3. Validate credentials</li>
        <li className={Boolean(dryRunState.planId) ? "active" : ""}>4. Dry-run</li>
        <li className={Boolean(runState.report) ? "active" : ""}>5. Execute</li>
      </ol>

      <section className="card">
        <h2>Step 1: Runner status</h2>
        <p className="muted">Start the local runner on your machine before running any migration calls.</p>
        <pre>{RUNNER_START_COMMAND}</pre>
        <div className="row">
          <button type="button" className="primary" onClick={refreshRunnerStatus}>
            Check runner status
          </button>
          <span className={statusClass(runnerState.status)}>{runnerState.message}</span>
        </div>
      </section>

      <section className="card">
        <h2>Step 2: Approve session</h2>
        <p className="muted">Enter the one-time PIN shown in the local runner console to mint a short-lived session token.</p>
        <label htmlFor="runner-pin">One-time PIN</label>
        <input
          id="runner-pin"
          type="password"
          placeholder="Enter runner PIN"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          disabled={!runnerState.online || sessionApproved}
        />
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={approveRunnerSession}
            disabled={!runnerState.online || sessionApproved || sessionState.status === "running"}
          >
            {sessionState.status === "running" ? "Approving..." : "Approve session"}
          </button>
          <span className={statusClass(sessionState.status)}>{sessionState.message}</span>
        </div>
        {sessionState.expiresAt ? <p className="muted">Session expires at: {sessionState.expiresAt}</p> : null}
      </section>

      <CredentialForm
        title="Source"
        value={sourceForm}
        onChange={setSourceForm}
        validation={sourceValidation}
        disabled={!runnerState.online || !sessionApproved}
      />

      <CredentialForm
        title="Target"
        value={targetForm}
        onChange={setTargetForm}
        validation={targetValidation}
        disabled={!runnerState.online || !sessionApproved}
      />

      <section className="card">
        <h2>Step 3: Validate credentials</h2>
        <p className="muted">Credentials stay in browser memory only for this active tab session.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={runValidation}
            disabled={!canValidate || sourceValidation.status === "validating" || targetValidation.status === "validating"}
          >
            {(sourceValidation.status === "validating" || targetValidation.status === "validating") ? "Validating..." : "Validate source + target"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Step 4: Dry-run</h2>
        <p className="muted">Dry-run is required before execute. Conflict mode is overwrite existing.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!canDryRun || dryRunState.status === "running"}
            onClick={runDryRun}
          >
            {dryRunState.status === "running" ? "Running dry-run..." : "Run dry-run"}
          </button>
          <span className={statusClass(dryRunState.status)}>{dryRunState.message}</span>
        </div>

        {summaryRows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Object type</th>
                  <th>Create</th>
                  <th>Update</th>
                  <th>Skip</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={row.type}>
                    <td>{row.label}</td>
                    <td>{row.create}</td>
                    <td>{row.update}</td>
                    <td>{row.skip}</td>
                    <td>{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {dryRunState.notes.length > 0 ? (
          <details>
            <summary>Dry-run notes</summary>
            <pre>{dryRunState.notes.join("\n")}</pre>
          </details>
        ) : null}
      </section>

      <section className="card">
        <h2>Step 5: Execute migration</h2>
        <p className="muted">Execution is sequential and dependency-safe. Runner exits automatically after the run.</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!canExecute || runState.status === "running"}
            onClick={runMigration}
          >
            {runState.status === "running" ? "Migrating..." : "Execute migration"}
          </button>

          {runState.report ? (
            <button
              type="button"
              className="secondary"
              onClick={() => downloadRunReport(runState.report)}
            >
              Export report
            </button>
          ) : null}
          <span className={statusClass(runState.status)}>{runState.message}</span>
        </div>

        {runState.result ? (
          <div className="result-grid">
            <div>Created: {runState.result.created || 0}</div>
            <div>Updated: {runState.result.updated || 0}</div>
            <div>Skipped: {runState.result.skipped || 0}</div>
            <div>Failed: {runState.result.failed || 0}</div>
          </div>
        ) : null}

        {runState.logs.length > 0 ? (
          <details>
            <summary>Execution logs</summary>
            <pre>{runState.logs.join("\n")}</pre>
          </details>
        ) : null}
      </section>
    </main>
  );
}

export default App;
