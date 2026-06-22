import { useEffect, useMemo, useState } from "react";

import DryRunSummary from "./components/DryRunSummary";
import ExecutionProgress from "./components/ExecutionProgress";
import ExportPanel from "./components/ExportPanel";
import ImportPanel from "./components/ImportPanel";
import ModeSelector from "./components/ModeSelector";
import WebhookBasicAuthSetup from "./components/WebhookBasicAuthSetup";
import { serializeBundle } from "./migration/bundleBuilder";
import { validateBundle } from "./migration/bundleValidator";
import { executeImport } from "./migration/executor";
import { exportConfiguration } from "./migration/exportService";
import { stableKeyFor } from "./migration/matchers";
import { DEFAULT_EXPORT_SCOPE } from "./migration/objectTypes";
import { buildDryRunPlan } from "./migration/planner";
import { downloadReportCsv, downloadReportJson } from "./migration/reportExporter";
import { rewriteZendeskWebhookEndpoint } from "./migration/webhookEndpointRewrite";
import { downloadFile, timestampedFilename } from "./utils/downloadFile";
import { parseJsonFile } from "./utils/parseUpload";
import { createCurrentInstanceApi } from "./zendesk/currentInstanceApi";

import "./App.css";

const DEFAULT_IMPORT_OPTIONS = {
  overwriteExisting: true,
  createOnly: false,
  includeInactive: false,
  continueOnError: true,
  webhookDependencyPolicy: "manual_required",
  webhookMappingText: "",
  fullTicketMigration: false,
  fullTicketAutoCreate: true,
};

const DEFAULT_TICKET_EXPORT_OPTIONS = {
  ticketExportMode: "date_range",
  ticketDateRange: {
    from: "",
    to: "",
  },
  ticketFilters: {
    channels: [],
    statuses: [],
    types: [],
    priorities: [],
    commentMode: "all",
    customFieldFilters: [],
  },
};

const DEFAULT_TICKET_IMPORT_OPTIONS = {
  ticketDateRange: {
    from: "",
    to: "",
  },
};

function appendLog(setter, entry) {
  setter((previous) => [...previous, entry]);
}

function parseWebhookMappingText(text) {
  const value = String(text || "").trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hasNotificationWebhookDependency(payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return text.includes('"notification_webhook"');
}

function popupForTicketRangeError(error, context) {
  if (!error) return null;
  if (error.includes("From date must be before")) {
    return {
      title: "Check the date range",
      message: "The From date must be before or the same as the To date.",
    };
  }
  if (context === "import") {
    return {
      title: "Ticket import range required",
      message: "Please choose a From date, a To date, or both before running the ticket import dry-run.",
    };
  }
  return {
    title: "Ticket date range required",
    message: "Please choose a From date, a To date, or both before exporting tickets. This prevents accidentally exporting every ticket in the account.",
  };
}

export function validateTicketExportOptions(scope, options) {
  if (!scope?.tickets) return "";
  const from = String(options.ticketDateRange?.from || "").trim();
  const to = String(options.ticketDateRange?.to || "").trim();
  if (!from && !to) return "A ticket date range is required to prevent accidental full ticket exports. Choose a From date, a To date, or both.";
  if (from && to && from > to) return "Ticket migration range is invalid: From date must be before or equal to To date.";
  return "";
}

export function validateTicketImportOptions(bundleSummary, options) {
  const ticketCount = Number(bundleSummary?.counts?.tickets || 0);
  if (ticketCount <= 0) return "";
  const from = String(options.ticketDateRange?.from || "").trim();
  const to = String(options.ticketDateRange?.to || "").trim();
  if (!from && !to) return "A ticket import date range is required before importing tickets. Choose a From date, a To date, or both.";
  if (from && to && from > to) return "Ticket import range is invalid: From date must be before or equal to To date.";
  return "";
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
  const [ticketExportOptions, setTicketExportOptions] = useState(DEFAULT_TICKET_EXPORT_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState([]);
  const [bundle, setBundle] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedBundle, setUploadedBundle] = useState(null);
  const [validation, setValidation] = useState({ valid: false, message: "", summary: null });
  const [importOptions, setImportOptions] = useState(DEFAULT_IMPORT_OPTIONS);
  const [ticketImportOptions, setTicketImportOptions] = useState(DEFAULT_TICKET_IMPORT_OPTIONS);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [plan, setPlan] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(null);
  const [executionLogs, setExecutionLogs] = useState([]);
  const [report, setReport] = useState(null);
  const [popup, setPopup] = useState(null);
  const [webhookSetup, setWebhookSetup] = useState({
    targetEmail: "",
    apiToken: "",
    endpointOverrides: {},
  });
  const [fullTicketSetup, setFullTicketSetup] = useState({
    sourceSubdomain: "",
    email: "",
    apiToken: "",
  });

  useEffect(() => {
    let active = true;

    async function loadStartupState() {
      try {
        const state = await api.getStartupState();
        if (!active) return;
        setStartup({ loading: false, error: "", state });
        setWebhookSetup((previous) => ({
          ...previous,
          targetEmail: previous.targetEmail || state?.currentUser?.email || "",
        }));
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
    const ticketRangeError = validateTicketExportOptions(scope, ticketExportOptions);
    if (ticketRangeError) {
      setPopup(popupForTicketRangeError(ticketRangeError, "export"));
      setBundle(null);
      return;
    }

    setExporting(true);
    setExportLogs([]);
    setBundle(null);

    try {
      const result = await exportConfiguration({
        api,
        startupState: startup.state,
        scope,
        options: { includeInactive: includeInactiveExport, ...ticketExportOptions },
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
    setWebhookSetup((previous) => ({ ...previous, apiToken: "", endpointOverrides: {} }));
    setFullTicketSetup((previous) => ({ ...previous, apiToken: "" }));
  }

  function updateTicketDateRange(key, value) {
    setTicketExportOptions((previous) => ({
      ...previous,
      ticketDateRange: {
        ...previous.ticketDateRange,
        [key]: value,
      },
    }));
    setBundle(null);
  }

  function updateTicketFilters(nextFilters) {
    setTicketExportOptions((previous) => ({
      ...previous,
      ticketFilters: {
        ...previous.ticketFilters,
        ...nextFilters,
      },
    }));
    setBundle(null);
  }

  function updateTicketImportDateRange(key, value) {
    setTicketImportOptions((previous) => ({
      ...previous,
      ticketDateRange: {
        ...previous.ticketDateRange,
        [key]: value,
      },
    }));
    if (uploadedBundle) {
      setValidation((previous) => ({
        ...previous,
        valid: true,
        message: previous.message?.includes("ticket import")
          ? "Bundle validation passed."
          : previous.message,
      }));
    }
    setPlan(null);
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
      setFullTicketSetup((previous) => ({
        ...previous,
        sourceSubdomain: previous.sourceSubdomain || parsed?.source?.subdomain || "",
        email: previous.email || startup.state?.currentUser?.email || "",
      }));
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
    const ticketRangeError = validateTicketImportOptions(validation.summary, ticketImportOptions);
    if (ticketRangeError) {
      setPopup(popupForTicketRangeError(ticketRangeError, "import"));
      setPlan(null);
      setReport(null);
      setConfirmed(false);
      return;
    }

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
        options: {
          ...importOptions,
          ticketImportDateRange: ticketImportOptions.ticketDateRange,
          webhookMapping: parseWebhookMappingText(importOptions.webhookMappingText),
          webhookAuthConfigured: Boolean(webhookSetup.targetEmail && webhookSetup.apiToken),
        },
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
    if (requiresWebhookSetup && (!webhookSetup.targetEmail || !webhookSetup.apiToken)) {
      appendLog(setExecutionLogs, "Webhook Basic Auth details are required because this bundle contains webhooks and dependent business rules.");
      return;
    }
    setExecuting(true);
    setExecutionLogs([]);
    setReport(null);

    try {
      const finalReport = await executeImport({
        api,
        bundle: uploadedBundle,
        plan,
        startupState: startup.state,
        webhookSetup: requiresWebhookSetup ? webhookSetup : null,
        fullTicketSetup: importOptions.fullTicketMigration ? fullTicketSetup : null,
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
      setWebhookSetup((previous) => ({ ...previous, apiToken: "" }));
      setFullTicketSetup((previous) => ({ ...previous, apiToken: "" }));
    }
  }

  const bundleWebhooks = uploadedBundle?.objects?.webhooks || [];
  const bundleTriggers = uploadedBundle?.objects?.ticket_triggers || [];
  const bundleAutomations = uploadedBundle?.objects?.automations || [];
  const dryRunHasWebhookDeps = (plan?.items || []).some((item) => item?.webhook_dependency);
  const requiresWebhookSetup =
    bundleWebhooks.length > 0 ||
    dryRunHasWebhookDeps ||
    bundleTriggers.some((item) => hasNotificationWebhookDependency(item?.payload)) ||
    bundleAutomations.some((item) => hasNotificationWebhookDependency(item?.payload));
  const targetSubdomain = startup.state?.context?.subdomain || "";
  const webhookPreview = bundleWebhooks.map((item, index) => {
    const sourceEndpoint = item?.payload?.endpoint || "";
    const rewritten = rewriteZendeskWebhookEndpoint({
      sourceEndpoint,
      targetSubdomain,
    });
    return {
      key: stableKeyFor("webhooks", item),
      name: item?.display_name || item?.payload?.name || `Webhook ${index + 1}`,
      sourceEndpoint,
      rewrittenEndpoint: rewritten.endpoint,
      warning: rewritten.warning,
    };
  });
  const dependentTriggers = bundleTriggers
    .filter((item) => hasNotificationWebhookDependency(item?.payload))
    .map((item) => item?.display_name || item?.payload?.title || "Untitled trigger");
  const dependentAutomations = bundleAutomations
    .filter((item) => hasNotificationWebhookDependency(item?.payload))
    .map((item) => item?.display_name || item?.payload?.title || "Untitled automation");
  const executeBlockedReason =
    requiresWebhookSetup && (!webhookSetup.targetEmail || !webhookSetup.apiToken)
      ? "Webhook Basic Auth details are required because this bundle contains webhooks and dependent business rules."
      : importOptions.fullTicketMigration &&
          (validation.summary?.counts?.tickets || 0) > 0 &&
          (!fullTicketSetup.sourceSubdomain || !fullTicketSetup.email || !fullTicketSetup.apiToken)
        ? "Source Zendesk credentials are required for full ticket migration."
      : "";

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

      {popup ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="range-warning-title">
            <h2 id="range-warning-title">{popup.title}</h2>
            <p>{popup.message}</p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={() => setPopup(null)} autoFocus>
                OK
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ModeSelector mode={mode} onSelect={setMode} />

      {mode === "export" ? (
        <ExportPanel
          startupState={startup.state}
          scope={scope}
          includeInactive={includeInactiveExport}
          ticketExportOptions={ticketExportOptions}
          onScopeChange={updateScope}
          onIncludeInactiveChange={setIncludeInactiveExport}
          onTicketDateRangeChange={updateTicketDateRange}
          onTicketFiltersChange={updateTicketFilters}
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
            ticketImportOptions={ticketImportOptions}
            fullTicketSetup={fullTicketSetup}
            onFileChange={handleFileChange}
            onValidate={validateUploadedBundle}
            onOptionChange={updateImportOption}
            onTicketImportDateRangeChange={updateTicketImportDateRange}
            onFullTicketSetupChange={(key, value) => setFullTicketSetup((previous) => ({ ...previous, [key]: value }))}
            onDryRun={runDryRun}
            dryRunRunning={dryRunRunning}
          />
          <WebhookBasicAuthSetup
            required={requiresWebhookSetup}
            targetEmail={webhookSetup.targetEmail}
            apiToken={webhookSetup.apiToken}
            onTargetEmailChange={(value) => setWebhookSetup((previous) => ({ ...previous, targetEmail: value }))}
            onApiTokenChange={(value) => setWebhookSetup((previous) => ({ ...previous, apiToken: value }))}
            targetSubdomain={targetSubdomain}
            webhooks={webhookPreview}
            dependentTriggers={dependentTriggers}
            dependentAutomations={dependentAutomations}
            endpointOverrides={webhookSetup.endpointOverrides}
            onEndpointOverrideChange={(key, value) =>
              setWebhookSetup((previous) => ({
                ...previous,
                endpointOverrides: { ...previous.endpointOverrides, [key]: value },
              }))
            }
          />
          <DryRunSummary
            plan={plan}
            confirmed={confirmed}
            onConfirmChange={setConfirmed}
            onExecute={executeConfirmedImport}
            executing={executing}
            executeDisabled={Boolean(executeBlockedReason)}
            executeDisabledReason={executeBlockedReason}
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
