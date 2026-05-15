function safeUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

export function isZendeskWebhookEndpoint(url) {
  const parsed = safeUrl(url);
  if (!parsed) return false;
  return parsed.hostname.toLowerCase().endsWith(".zendesk.com");
}

export function extractWebhookPath(url) {
  const value = String(url || "").trim();
  const parsed = safeUrl(value);
  if (!parsed) return "";
  const host = parsed.host;
  const marker = `${parsed.protocol}//${host}`;
  const index = value.indexOf(marker);
  if (index === -1) return `${parsed.pathname || ""}${parsed.search || ""}`;
  const rawSuffix = value.slice(index + marker.length);
  return rawSuffix || "/";
}

export function rewriteZendeskWebhookEndpoint({ sourceEndpoint, targetSubdomain }) {
  const source = String(sourceEndpoint || "").trim();
  const subdomain = String(targetSubdomain || "").trim().toLowerCase();
  const parsed = safeUrl(source);

  if (!parsed || !subdomain) {
    return {
      endpoint: source,
      rewritten: false,
      warning: "Webhook endpoint could not be rewritten automatically.",
      sourceHost: parsed?.hostname || "",
      targetHost: "",
    };
  }

  if (!isZendeskWebhookEndpoint(source)) {
    return {
      endpoint: source,
      rewritten: false,
      warning: "This webhook endpoint does not appear to be a Zendesk URL. Confirm it is valid for the target instance.",
      sourceHost: parsed.hostname,
      targetHost: parsed.hostname,
    };
  }

  const targetHost = `${subdomain}.zendesk.com`;
  const pathAndQuery = extractWebhookPath(source);
  const rewrittenEndpoint = `https://${targetHost}${pathAndQuery}`;
  return {
    endpoint: rewrittenEndpoint,
    rewritten: true,
    warning: "",
    sourceHost: parsed.hostname,
    targetHost,
  };
}
