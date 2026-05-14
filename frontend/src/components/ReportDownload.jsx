export default function ReportDownload({ report, onDownloadJson, onDownloadCsv }) {
  if (!report) return null;

  return (
    <div className="toolbar">
      <button type="button" className="secondary" onClick={onDownloadJson}>
        Download JSON report
      </button>
      <button type="button" className="secondary" onClick={onDownloadCsv}>
        Download CSV summary
      </button>
    </div>
  );
}
