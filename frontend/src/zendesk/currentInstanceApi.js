import { createRequestQueue } from "../utils/rateLimit";
import { getZafClient } from "./zafClient";

function extractPayload(raw) {
  if (raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "responseJSON")) {
    return raw.responseJSON;
  }
  return raw;
}

function extractHeaders(raw) {
  return raw?.headers || raw?.responseHeaders || {};
}

function getErrorMessage(error) {
  return (
    error?.responseJSON?.details?.base?.[0]?.description ||
    error?.responseJSON?.error ||
    error?.responseJSON?.description ||
    error?.responseText ||
    error?.message ||
    "The Zendesk API request did not return an actionable error message."
  );
}

export function classifyApiError(error, path = "") {
  const status = Number(error?.status || error?.statusCode || error?.responseJSON?.status || 0);
  const message = getErrorMessage(error);

  if (status === 401 || status === 403) {
    return {
      code: "permission_denied",
      status,
      message: `${path || "Zendesk API"} is not available to the current Zendesk session. ${message}`,
    };
  }

  if (status === 404) {
    return {
      code: "unsupported_from_client_app",
      status,
      message: `${path || "Zendesk API"} is not available from this Zendesk app context. ${message}`,
    };
  }

  if (status === 429) {
    return {
      code: "rate_limited",
      status,
      message: `${path || "Zendesk API"} was rate limited. The request queue will retry before surfacing a failure.`,
    };
  }

  if (status >= 500) {
    return {
      code: "zendesk_api_error",
      status,
      message: `${path || "Zendesk API"} returned a server error. ${message}`,
    };
  }

  return {
    code: "zendesk_api_error",
    status,
    message: `${path || "Zendesk API"} failed. ${message}`,
  };
}

function assertRelativePath(path) {
  const value = String(path || "");
  if (!value.startsWith("/")) {
    throw new Error(`Zendesk API path must be relative and start with "/". Received "${value || "(empty)"}".`);
  }
  if (/^https?:\/\//i.test(value)) {
    throw new Error("Zendesk API path must not include a full domain.");
  }
  return value;
}

function toRelativePath(nextPage) {
  if (!nextPage) return null;
  const value = String(nextPage);
  if (value.startsWith("/")) return value;

  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function resolveNextPath(payload) {
  return (
    toRelativePath(payload?.next_page) ||
    toRelativePath(payload?.links?.next) ||
    toRelativePath(payload?.meta?.after_cursor ? `${payload?.links?.next || ""}` : "")
  );
}

function isAdminUser(user) {
  const role = String(user?.role || user?.role_type || "").toLowerCase();
  return role === "admin" || role === "administrator" || role === "account_owner" || user?.is_admin === true;
}

function normalizeContext(context) {
  const account = context?.account || {};
  return {
    subdomain: account.subdomain || context?.subdomain || "",
    account_name: account.name || "",
    raw: context || {},
  };
}

export function createCurrentInstanceApi({ client = null, queue = createRequestQueue({ concurrency: 1 }) } = {}) {
  let cachedClient = client;

  function ensureClient() {
    if (!cachedClient) cachedClient = getZafClient();
    return cachedClient;
  }

  async function request({ path, method = "GET", body, contentType = "application/json" }) {
    const relativePath = assertRelativePath(path);

    return queue.run(async () => {
      try {
        const zafClient = ensureClient();
        const response = await zafClient.request({
          url: relativePath,
          type: method,
          contentType,
          dataType: "json",
          httpCompleteResponse: true,
          data: body === undefined ? undefined : JSON.stringify(body),
        });
        return {
          data: extractPayload(response),
          headers: extractHeaders(response),
        };
      } catch (error) {
        const classified = classifyApiError(error, relativePath);
        const wrapped = new Error(classified.message);
        wrapped.status = classified.status;
        wrapped.code = classified.code;
        wrapped.path = relativePath;
        wrapped.cause = error;
        throw wrapped;
      }
    });
  }

  async function fetchAll(path, collectionKey) {
    const results = [];
    let nextPath = assertRelativePath(path);
    const seen = new Set();

    while (nextPath) {
      if (seen.has(nextPath)) {
        throw new Error(`Pagination loop detected while reading ${nextPath}.`);
      }
      seen.add(nextPath);

      const { data } = await request({ path: nextPath, method: "GET" });
      const collection = Array.isArray(data?.[collectionKey]) ? data[collectionKey] : [];
      results.push(...collection);

      const resolved = resolveNextPath(data);
      const hasMore = data?.meta?.has_more === true || Boolean(data?.next_page || data?.links?.next);
      nextPath = hasMore ? resolved : null;
    }

    return results;
  }

  async function getContext() {
    const zafClient = ensureClient();
    if (typeof zafClient.context === "function") {
      return normalizeContext(await zafClient.context());
    }
    return normalizeContext({});
  }

  async function getCurrentUser() {
    const { data } = await request({ path: "/api/v2/users/me.json", method: "GET" });
    return data?.user || data;
  }

  async function getStartupState() {
    const [context, currentUser] = await Promise.all([getContext(), getCurrentUser()]);
    return {
      context,
      currentUser,
      isAdmin: isAdminUser(currentUser),
    };
  }

  return {
    request,
    fetchAll,
    getContext,
    getCurrentUser,
    getStartupState,
  };
}
