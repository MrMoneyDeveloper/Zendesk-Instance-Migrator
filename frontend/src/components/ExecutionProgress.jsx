import ReportDownload from "./ReportDownload";

function classifyExecutionStatus(progress, logs, report) {
  if (report?.summary?.failed > 0 || logs.some((entry) => String(entry).toLowerCase().includes("could not be imported"))) return "Completed with errors";
  if (report) return "Completed";
  if (progress?.currentObjectType) return "Importing";
  return "Ready";
}

function recentLogs(logs) {
  return logs.slice(-3).reverse();
}

function progressPercent(progress, report) {
  if (report) return 100;
  const percent = Number(progress?.percentComplete);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function ExecutionStatusCard({ progress, logs = [], report }) {
  const status = classifyExecutionStatus(progress, logs, report);
  const latestLogs = recentLogs(logs);
  const percent = progressPercent(progress, report);
  const hasProgressTotal = Number(progress?.totalItems) > 0;
  const progressLabel = hasProgressTotal
    ? `${percent}% complete (${progress.currentIndex} of ${progress.totalItems})`
    : `${percent}% complete`;

  return (
    <aside className="execution-status-card" aria-label="Import execution status">
      <div className="status-card-header">
        <span className={`status-dot status-${status.toLowerCase().replace(/\s+/g, "-")}`} />
        <div>
          <h3>Status: {status}</h3>
          <p className="muted">Import execution for this run.</p>
        </div>
      </div>

      <div className="status-progress" aria-label="Import progress">
        <div className="status-progress-label">{progressLabel}</div>
        <div className="status-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
          <div className="status-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <dl className="details-list status-details">
        <dt>Current item</dt>
        <dd>{progress?.currentItem || "--"}</dd>
        <dt>Object type</dt>
        <dd>{progress?.currentObjectType || "--"}</dd>
        <dt>Log entries</dt>
        <dd>{logs.length}</dd>
      </dl>

      <div className="recent-activity">
        <h4>Recent activity</h4>
        {latestLogs.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <ul className="compact-list">
            {latestLogs.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default function ExecutionProgress({ progress, logs, report, onDownloadJson, onDownloadCsv, showStatus = true }) {
  if (!progress && logs.length === 0 && !report) return null;

  return (
    <section className="panel execution-dashboard">
      <div className="execution-main-card">
        <div className="panel-header">
          <div>
            <h2>Execution progress</h2>
            <p className="muted">
              {progress?.currentObjectType ? `${progress.currentObjectType}: ${progress.currentItem}` : "Import execution has not started."}
            </p>
          </div>
          <ReportDownload report={report} onDownloadJson={onDownloadJson} onDownloadCsv={onDownloadCsv} />
        </div>

        <div className="log" role="log" aria-live="polite">
          {logs.length === 0 ? <p className="muted">No execution activity yet.</p> : logs.map((entry, index) => <div key={`${entry}-${index}`}>{entry}</div>)}
        </div>
      </div>

      {showStatus ? <ExecutionStatusCard progress={progress} logs={logs} report={report} /> : null}
    </section>
  );
}
