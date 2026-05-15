const SECRET_KEYS = new Set(["password", "token", "secret", "authorization", "api_key", "client_secret"]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function buildZendeskBasicAuthUsername(email) {
  return `${String(email || "").trim()}/token`;
}

export function buildWebhookAuthentication({ email, apiToken }) {
  return {
    type: "basic_auth",
    add_position: "header",
    data: {
      username: buildZendeskBasicAuthUsername(email),
      password: String(apiToken || ""),
    },
  };
}

export function stripWebhookSecrets(webhook) {
  const copy = structuredClone(webhook || {});
  if (copy?.authentication?.data && isPlainObject(copy.authentication.data)) {
    for (const key of Object.keys(copy.authentication.data)) {
      if (SECRET_KEYS.has(String(key).toLowerCase())) {
        delete copy.authentication.data[key];
      }
    }
  }
  return copy;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry));
  if (!isPlainObject(value)) return value;

  const cleaned = {};
  for (const [key, entry] of Object.entries(value)) {
    const lower = String(key).toLowerCase();
    if (SECRET_KEYS.has(lower)) {
      cleaned[key] = "[REDACTED]";
      continue;
    }
    cleaned[key] = redactSecrets(entry);
  }
  return cleaned;
}

