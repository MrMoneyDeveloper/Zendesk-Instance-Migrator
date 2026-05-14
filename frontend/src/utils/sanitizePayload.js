const READ_ONLY_KEYS = new Set([
  "id",
  "url",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "created_by_user_id",
  "updated_by_user_id",
  "creator_id",
  "generated_timestamp",
  "html_url",
  "default",
  "raw_title",
  "raw_title_in_portal",
  "removable",
  "system",
  "account_id",
]);

const SECRET_KEYS = new Set([
  "authorization",
  "password",
  "secret",
  "token",
  "api_key",
  "client_secret",
]);

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shouldDropKey(key, { stripSecrets }) {
  const lower = String(key).toLowerCase();
  if (READ_ONLY_KEYS.has(lower)) return true;
  if (stripSecrets && SECRET_KEYS.has(lower)) return true;
  if (lower.endsWith("_url") || lower === "self") return true;
  return false;
}

export function sanitizePayload(value, options = {}) {
  const stripSecrets = options.stripSecrets !== false;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePayload(item, options));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.entries(value).reduce((cleaned, [key, entry]) => {
    if (shouldDropKey(key, { stripSecrets })) {
      return cleaned;
    }

    cleaned[key] = sanitizePayload(entry, options);
    return cleaned;
  }, {});
}

export function metadataFromSource(source, extra = {}) {
  const metadata = { ...extra };
  if (source?.id !== undefined && source?.id !== null) metadata.source_id = source.id;
  if (source?.position !== undefined) metadata.order = source.position;
  if (source?.order !== undefined) metadata.order = source.order;
  if (source?.key) metadata.source_key = source.key;
  return metadata;
}

export function hasWebhookSecretRequirement(webhook) {
  const authentication = webhook?.authentication;
  if (!authentication || typeof authentication !== "object") return false;

  const type = String(authentication.type || "").toLowerCase();
  if (!type || type === "none") return false;

  const data = authentication.data || {};
  const serialized = JSON.stringify(data).toLowerCase();
  const hasSecretShape = ["password", "token", "value", "secret", "api_key"].some((key) => serialized.includes(key));
  return ["basic_auth", "bearer_token", "api_key", "oauth2", "jwt"].includes(type) || hasSecretShape;
}

export function sanitizeWebhookPayload(webhook) {
  const clean = sanitizePayload(webhook, { stripSecrets: true });
  if (clean.authentication) {
    delete clean.authentication;
  }
  return clean;
}
