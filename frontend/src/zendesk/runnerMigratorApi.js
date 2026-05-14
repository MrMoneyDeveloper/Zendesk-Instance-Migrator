import { getZafClient } from "./zafClient";

const RUNNER_BASE_URL = "http://127.0.0.1:8765";

function normalizeInstance(value) {
  const input = String(value || "").trim();
  if (!input) return { baseUrl: "", subdomain: "" };

  const lower = input.toLowerCase();
  const looksLikeUrl = lower.startsWith("http://") || lower.startsWith("https://") || lower.includes(".zendesk.com");
  if (looksLikeUrl) {
    return { baseUrl: input, subdomain: "" };
  }

  return { baseUrl: "", subdomain: input };
}

function normalizeCredentials(form) {
  const instance = normalizeInstance(form?.instance);
  return {
    base_url: instance.baseUrl,
    subdomain: instance.subdomain,
    email: String(form?.email || "").trim(),
    api_token: String(form?.apiToken || "").trim(),
  };
}

function isCredentialComplete(form) {
  const value = normalizeCredentials(form);
  return Boolean((value.base_url || value.subdomain) && value.email && value.api_token);
}

function extractResponsePayload(raw) {
  if (raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "responseJSON")) {
    return raw.responseJSON;
  }
  return raw;
}

async function runnerRequest({ client, method, path, payload, sessionToken }) {
  const url = `${RUNNER_BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (sessionToken) {
    headers["X-Session-Token"] = String(sessionToken);
  }

  try {
    const response = await client.request({
      url,
      type: method,
      cors: true,
      contentType: "application/json",
      dataType: "json",
      httpCompleteResponse: true,
      headers,
      data: payload ? JSON.stringify(payload) : undefined,
    });
    return extractResponsePayload(response);
  } catch (error) {
    const status = error?.status || error?.statusCode || error?.responseJSON?.status;
    const detail = error?.responseJSON?.detail || error?.responseJSON?.error || error?.message || "Runner request failed.";
    const wrapped = new Error(status ? `${detail} (${status})` : detail);
    wrapped.status = status;
    wrapped.cause = error;
    throw wrapped;
  }
}

export function createRunnerMigratorApi() {
  let client = null;

  function ensureClient() {
    if (!client) {
      client = getZafClient();
    }
    return client;
  }

  async function validate({ sourceForm, targetForm, sessionToken }) {
    return runnerRequest({
      client: ensureClient(),
      method: "POST",
      path: "/api/migrator/validate",
      sessionToken,
      payload: {
        source: normalizeCredentials(sourceForm),
        target: normalizeCredentials(targetForm),
      },
    });
  }

  async function dryRun({ sourceForm, targetForm, sessionToken }) {
    return runnerRequest({
      client: ensureClient(),
      method: "POST",
      path: "/api/migrator/dry-run",
      sessionToken,
      payload: {
        source: normalizeCredentials(sourceForm),
        target: normalizeCredentials(targetForm),
        options: {
          active_only: true,
          overwrite_existing: true,
          include_omnichannel: true,
        },
      },
    });
  }

  async function execute({ sourceForm, targetForm, planId, sessionToken }) {
    return runnerRequest({
      client: ensureClient(),
      method: "POST",
      path: "/api/migrator/execute",
      sessionToken,
      payload: {
        plan_id: planId,
        source: normalizeCredentials(sourceForm),
        target: normalizeCredentials(targetForm),
        options: {
          active_only: true,
          overwrite_existing: true,
          include_omnichannel: true,
        },
      },
    });
  }

  async function getRun(runId, sessionToken) {
    return runnerRequest({
      client: ensureClient(),
      method: "GET",
      path: `/api/migrator/run/${encodeURIComponent(runId)}`,
      sessionToken,
    });
  }

  async function health() {
    return runnerRequest({
      client: ensureClient(),
      method: "GET",
      path: "/health",
    });
  }

  async function approveSession(pin) {
    return runnerRequest({
      client: ensureClient(),
      method: "POST",
      path: "/session/approve",
      payload: {
        pin: String(pin || "").trim(),
      },
    });
  }

  return {
    runnerBaseUrl: RUNNER_BASE_URL,
    normalizeCredentials,
    isCredentialComplete,
    health,
    approveSession,
    validate,
    dryRun,
    execute,
    getRun,
  };
}
