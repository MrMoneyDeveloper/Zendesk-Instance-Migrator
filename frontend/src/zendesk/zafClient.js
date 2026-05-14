let cachedClient = null;

export function setZafClientForTests(client) {
  cachedClient = client;
}

export function getZafClient() {
  if (cachedClient) return cachedClient;
  if (typeof window !== "undefined" && window.__ZAF_CLIENT__) {
    cachedClient = window.__ZAF_CLIENT__;
    return cachedClient;
  }
  if (typeof window !== "undefined" && window.ZAFClient && typeof window.ZAFClient.init === "function") {
    cachedClient = window.ZAFClient.init();
    return cachedClient;
  }
  throw new Error("Zendesk App Framework SDK (ZAFClient) is not available.");
}
