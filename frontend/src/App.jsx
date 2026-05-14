import { useEffect, useMemo, useState } from "react";

import DryRunSummary from "./components/DryRunSummary";
import ExecutionProgress from "./components/ExecutionProgress";
import ExportPanel from "./components/ExportPanel";
import ImportPanel from "./components/ImportPanel";
import ModeSelector from "./components/ModeSelector";
import { serializeBundle } from "./migration/bundleBuilder";
import { validateBundle } from "./migration/bundleValidator";
import { executeImport } from "./migration/executor";
import { exportConfiguration } from "./migration/exportService";
import { DEFAULT_EXPORT_SCOPE } from "./migration/objectTypes";
import { buildDryRunPlan } from "./migration/planner";
import { downloadReportCsv, downloadReportJson } from "./migration/reportExporter";
import { downloadFile, timestampedFilename } from "./utils/downloadFile";
import { parseJsonFile } from "./utils/parseUpload";
import { createCurrentInstanceApi } from "./zendesk/currentInstanceApi";

import "./App.css";

const DEFAULT_IMPORT_OPTIONS = {
  overwriteExisting: true,
  createOnly: false,
  includeInactive: false,
  continueOnError: true,
};

function appendLog(setter, entry) {
  setter((previous) => [...previous, entry]);
}

function App() {
  const api = useMemo(() => createCurrentInstanceApi(), []);
  const [startup, setStartup] = useState({
    loading: true,
    error: "",
    state: null,
  });
  const [mode, setMode] = useState("export");
  const [scope, setScope] = useState({ ...DEFAULT_EXPORT_SCOPE });
  const [includeInactiveExport, setIncludeInactiveExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState([]);
  const [bundle, setBundle] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedBundle, setUploadedBundle] = useState(null);
  const [validation, setValidation] = useState({ valid: false, message: "", summary: null });
  const [importOptions, setImportOptions] = useState(DEFAULT_IMPORT_OPTIONS);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(null);
  const [executionLogs, setExecutionLogs] = useState([]);
  const [report, setReport] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadStartupState() {
      try {
        const state = await api.getStartupState();
        if (!active) return;
        setStartup({ loading: false, error: "", state });
      } catch (error) {
        if (!active) return;
        setStartup({
          loading: false,
          error: error?.message || "The app could not read the current Zendesk session.",
          state: null,
        });
      }
    }

    void loadStartupState();
    return () => {
      active = false;
    };
  }, [api]);

  function updateScope(type, selected) {
    setScope((previous) => ({ ...previous, [type]: selected }));
    setBundle(null);
  }

  async function runExport() {
    setExporting(true);
    setExportLogs([]);
    setBundle(null);

    try {
      const result = await exportConfiguration({
        api,
        startupState: startup.state,
        scope,
        options: { includeInactive: includeInactiveExport },
        onLog: (entry) => appendLog(setExportLogs, entry),
      });
      setBundle(result);
    } catch (error) {
      appendLog(setExportLogs, error?.message || "Export could not complete.");
    } finally {
      setExporting(false);
    }
  }

  function downloadBundle() {
    if (!bundle) return;
    downloadFile({
      filename: timestampedFilename("migration-bundle", "json"),
      content: serializeBundle(bundle),
      mimeType: "application/json",
    });
  }

  function handleFileChange(file) {
    setSelectedFile(file);
    setUploadedBundle(null);
    setValidation({ valid: false, message: "", summary: null });
    setPlan(null);
    setReport(null);
    setConfirmed(false);
  }

  async function validateUploadedBundle() {
    try {
      const parsed = await parseJsonFile(selectedFile);
      const result = validateBundle(parsed);
      setUploadedBundle(result.valid ? parsed : null);
      setValidation({
        valid: result.valid,
        message: result.valid ? "Bundle validation passed." : result.errors.join(" "),
        summary: result.summary,
      });
      setPlan(null);
      setConfirmed(false);
    } catch (error) {
      setUploadedBundle(null);
      setValidation({
        valid: false,
        message: error?.message || "The migration bundle could not be parsed.",
        summary: null,
      });
    }
  }

  function updateImportOption(key, value) {
    setImportOptions((previous) => ({ ...previous, [key]: value }));
    setPlan(null);
    setConfirmed(false);
  }

  async function runDryRun() {
    if (!uploadedBundle) return;
    setDryRunRunning(true);
    setPlan(null);
    setReport(null);
    setConfirmed(false);
    setExecutionLogs([]);

    try {
      const dryRunPlan = await buildDryRunPlan({
        api,
        bundle: uploadedBundle,
        startupState: startup.state,
        options: importOptions,
      });
      setPlan(dryRunPlan);
    } catch (error) {
      setValidation((previous) => ({
        ...previous,
        valid: false,
        message: error?.message || "Dry-run could not complete.",
      }));
    } finally {
      setDryRunRunning(false);
    }
  }

  async function executeConfirmedImport() {
    if (!uploadedBundle || !plan || !confirmed) return;
    setExecuting(true);
    setExecutionLogs([]);
    setReport(null);

    try {
      const finalReport = await executeImport({
        api,
        bundle: uploadedBundle,
        plan,
        startupState: startup.state,
        onProgress: (progress) => {
          setExecutionProgress(progress);
          appendLog(setExecutionLogs, progress.message);
        },
      });
      setReport(finalReport);
      setExecutionLogs(finalReport.logs || []);
    } catch (error) {
      appendLog(setExecutionLogs, error?.message || "Import execution could not complete.");
    } finally {
      setExecuting(false);
    }
  }

  if (startup.loading) {
    return (
      <main className="app">
        <section className="panel">
          <h1>Instance Config Migrator</h1>
          <p className="muted">Checking current instance and admin access.</p>
        </section>
      </main>
    );
  }

  if (startup.error) {
    return (
      <main className="app">
        <section className="panel">
          <h1>Instance Config Migrator</h1>
          <div className="notice error">{startup.error}</div>
        </section>
      </main>
    );
  }

  if (!startup.state?.isAdmin) {
    return (
      <main className="app">
        <section className="panel">
          <h1>Instance Config Migrator</h1>
          <div className="notice error">
            This app must be run by a Zendesk admin because it reads and writes instance configuration.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>Instance Config Migrator</h1>
          <p className="muted">
            Current instance detected: {startup.state.context?.subdomain || "Unavailable"}; signed in as{" "}
            {startup.state.currentUser?.email || "current admin"}.
          </p>
        </div>
      </header>

      <ModeSelector mode={mode} onSelect={setMode} />

      {mode === "export" ? (
        <ExportPanel
          startupState={startup.state}
          scope={scope}
          includeInactive={includeInactiveExport}
          onScopeChange={updateScope}
          onIncludeInactiveChange={setIncludeInactiveExport}
          onRunExport={runExport}
          exporting={exporting}
          logs={exportLogs}
          bundle={bundle}
          onDownloadBundle={downloadBundle}
        />
      ) : (
        <>
          <ImportPanel
            fileName={selectedFile?.name || ""}
            validation={validation}
            bundleSummary={validation.summary}
            options={importOptions}
            onFileChange={handleFileChange}
            onValidate={validateUploadedBundle}
            onOptionChange={updateImportOption}
            onDryRun={runDryRun}
            dryRunRunning={dryRunRunning}
          />
          <DryRunSummary
            plan={plan}
            confirmed={confirmed}
            onConfirmChange={setConfirmed}
            onExecute={executeConfirmedImport}
            executing={executing}
          />
          <ExecutionProgress
            progress={executionProgress}
            logs={executionLogs}
            report={report}
            onDownloadJson={() => downloadReportJson(report)}
            onDownloadCsv={() => downloadReportCsv(report)}
          />
        </>
      )}
    </main>
  );
}

export default App;
