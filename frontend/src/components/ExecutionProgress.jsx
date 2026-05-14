import ReportDownload from "./ReportDownload";

export default function ExecutionProgress({ progress, logs, report, onDownloadJson, onDownloadCsv }) {
  if (!progress && logs.length === 0 && !report) return null;

  return (
    <section className="panel">
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
    </section>
  );
}
