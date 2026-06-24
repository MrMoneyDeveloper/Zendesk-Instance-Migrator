import { useEffect, useMemo, useState } from "react";

import DryRunSummary from "./components/DryRunSummary";
import ExecutionProgress, { ExecutionStatusCard } from "./components/ExecutionProgress";
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
  helpCenterTargetBrandId: "",
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
    brandIds: [],
    groupIds: [],
    assigneeIds: [],
    requesterIds: [],
    organizationIds: [],
    ticketFormIds: [],
    tags: [],
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

const EMPTY_TICKET_FILTER_OPTIONS = {
  brands: [],
  groups: [],
  ticketForms: [],
  users: [],
  organizations: [],
  ticketFields: [],
  loading: false,
  error: "",
};

const EMPTY_HELP_CENTER_DESTINATION_OPTIONS = {
  brands: [],
  loading: false,
  error: "",
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

function helpCenterItemCount(bundleSummary) {
  return (
    Number(bundleSummary?.counts?.help_center_categories || 0) +
    Number(bundleSummary?.counts?.help_center_sections || 0) +
    Number(bundleSummary?.counts?.help_center_articles || 0)
  );
}

function buildImportSteps({ selectedFile, validation, plan, executing, report }) {
  const hasFile = Boolean(selectedFile);
  const validated = Boolean(validation?.valid);
  const dryRunReady = Boolean(plan);
  const importing = Boolean(executing || report);

  return [
    { label: "Upload bundle", complete: hasFile, active: !hasFile },
    { label: "Validate", complete: validated, active: hasFile && !validated },
    { label: "Dry-run", complete: dryRunReady, active: validated && !dryRunReady },
    { label: "Review", complete: importing, active: dryRunReady && !importing },
    { label: "Import", complete: Boolean(report), active: Boolean(executing) },
  ];
}

function App() {
  const api = useMemo(() => createCurrentInstanceApi(), []);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("instance-config-migrator-theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [startup, setStartup] = useState({
    loading: true,
    error: "",
    state: null,
  });
  const [mode, setMode] = useState("export");
  const [scope, setScope] = useState({ ...DEFAULT_EXPORT_SCOPE });
  const [includeInactiveExport, setIncludeInactiveExport] = useState(false);
  const [ticketExportOptions, setTicketExportOptions] = useState(DEFAULT_TICKET_EXPORT_OPTIONS);
  const [ticketFilterOptions, setTicketFilterOptions] = useState(EMPTY_TICKET_FILTER_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const [exportLogs, setExportLogs] = useState([]);
  const [bundle, setBundle] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedBundle, setUploadedBundle] = useState(null);
  const [validation, setValidation] = useState({ valid: false, message: "", summary: null });
  const [importOptions, setImportOptions] = useState(DEFAULT_IMPORT_OPTIONS);
  const [helpCenterDestinationOptions, setHelpCenterDestinationOptions] = useState(EMPTY_HELP_CENTER_DESTINATION_OPTIONS);
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

  useEffect(() => {
    try {
      localStorage.setItem("instance-config-migrator-theme", theme);
    } catch {
      // Theme persistence is best-effort only.
    }
    document.body.classList.toggle("instance-migrator-dark", theme === "dark");
    document.body.classList.toggle("instance-migrator-light", theme !== "dark");

    return () => {
      document.body.classList.remove("instance-migrator-dark", "instance-migrator-light");
    };
  }, [theme]);

  function toggleTheme() {
    setTheme((previous) => (previous === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    let active = true;

    async function loadTicketFilterOptions() {
      if (!scope.tickets) {
        setTicketFilterOptions(EMPTY_TICKET_FILTER_OPTIONS);
        return;
      }

      setTicketFilterOptions((previous) => ({ ...previous, loading: true, error: "" }));
      const requests = [
        ["brands", "/api/v2/brands.json", "brands"],
        ["groups", "/api/v2/groups.json", "groups"],
        ["ticketForms", "/api/v2/ticket_forms.json", "ticket_forms"],
        ["users", "/api/v2/users.json", "users"],
        ["organizations", "/api/v2/organizations.json", "organizations"],
        ["ticketFields", "/api/v2/ticket_fields.json", "ticket_fields"],
      ];

      const results = await Promise.allSettled(
        requests.map(([, path, collectionKey]) => api.fetchAll(path, collectionKey)),
      );
      if (!active) return;

      const next = { ...EMPTY_TICKET_FILTER_OPTIONS };
      const failed = [];
      requests.forEach(([key, path], index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
          next[key] = Array.isArray(result.value) ? result.value : [];
        } else {
          failed.push(path);
        }
      });
      next.loading = false;
      next.error = failed.length ? "Some ticket filter options could not be loaded. You can still export with the available filters." : "";
      setTicketFilterOptions(next);
    }

    void loadTicketFilterOptions();
    return () => {
      active = false;
    };
  }, [api, scope.tickets]);

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
      if (result.valid && helpCenterItemCount(result.summary) > 0) {
        setHelpCenterDestinationOptions((previous) => ({ ...previous, loading: true, error: "" }));
        try {
          const brands = await api.fetchAll("/api/v2/brands.json", "brands");
          setHelpCenterDestinationOptions({ brands: Array.isArray(brands) ? brands : [], loading: false, error: "" });
        } catch {
          setHelpCenterDestinationOptions({
            brands: [],
            loading: false,
            error: "Target brands could not be loaded. The import will use the current instance default Help Center.",
          });
        }
      } else {
        setHelpCenterDestinationOptions(EMPTY_HELP_CENTER_DESTINATION_OPTIONS);
        setImportOptions((previous) => ({ ...previous, helpCenterTargetBrandId: "" }));
      }
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
    setExecutionProgress(null);

    try {
      const dryRunPlan = await buildDryRunPlan({
        api,
        bundle: uploadedBundle,
        startupState: startup.state,
        options: {
          ...importOptions,
          ticketImportDateRange: ticketImportOptions.ticketDateRange,
          helpCenterTargetBrandId: importOptions.helpCenterTargetBrandId,
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
    setExecutionProgress(null);
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
      setExecutionProgress(null);
      setExecutionLogs(finalReport.logs || []);
    } catch (error) {
      setExecutionProgress(null);
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
  const importSteps = buildImportSteps({ selectedFile, validation, plan, executing, report });

  if (startup.loading) {
    return (
      <main className={`app theme-${theme}`}>
        <section className="panel">
          <h1>Instance Config Migrator</h1>
          <p className="muted">Checking current instance and admin access.</p>
        </section>
      </main>
    );
  }

  if (startup.error) {
    return (
      <main className={`app theme-${theme}`}>
        <section className="panel">
          <h1>Instance Config Migrator</h1>
          <div className="notice error">{startup.error}</div>
        </section>
      </main>
    );
  }

  if (!startup.state?.isAdmin) {
    return (
      <main className={`app theme-${theme}`}>
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
    <main className={`app theme-${theme}`}>
      <header className="app-header">
        <div className="app-header-main">
          <div className="app-icon-tile" aria-hidden="true">ICM</div>
          <div>
            <h1>Instance Config Migrator</h1>
            <div className="header-meta-grid" aria-label="Current Zendesk session">
              <div className="header-meta-card">
                <span>Current instance</span>
                <strong>{startup.state.context?.subdomain || "Unavailable"}</strong>
              </div>
              <div className="header-meta-card">
                <span>Signed in as</span>
                <strong>{startup.state.currentUser?.email || "current admin"}</strong>
              </div>
            </div>
          </div>
        </div>
        <button type="button" className="theme-toggle" onClick={toggleTheme}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
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
          ticketFilterOptions={ticketFilterOptions}
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
        <div className="import-dashboard">
          <div className="import-main-flow">
            <ImportPanel
              fileName={selectedFile?.name || ""}
              validation={validation}
              bundleSummary={validation.summary}
              options={importOptions}
              helpCenterDestinationOptions={helpCenterDestinationOptions}
              ticketImportOptions={ticketImportOptions}
              fullTicketSetup={fullTicketSetup}
              importSteps={importSteps}
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
              showStatus={false}
            />
          </div>
          <ExecutionStatusCard progress={executionProgress} logs={executionLogs} report={report} />
        </div>
      )}
    </main>
  );
}

export default App;
