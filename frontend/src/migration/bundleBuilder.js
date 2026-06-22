import { APP_NAME, BUNDLE_VERSION, MIGRATION_OBJECT_ORDER } from "./objectTypes";

function emptyObjects() {
  return MIGRATION_OBJECT_ORDER.reduce((objects, type) => {
    objects[type] = [];
    return objects;
  }, {});
}

function countObjects(objects) {
  return Object.entries(objects).reduce((counts, [type, values]) => {
    counts[type] = Array.isArray(values) ? values.length : 0;
    return counts;
  }, {});
}

export function createEmptyBundle({ source, scope }) {
  const objects = emptyObjects();
  return {
    bundle_version: BUNDLE_VERSION,
    app_name: APP_NAME,
    exported_at: new Date().toISOString(),
    source: {
      subdomain: source?.subdomain || "",
      account_name: source?.account_name || "",
      current_user_id: source?.current_user_id || null,
      current_user_email: source?.current_user_email || "",
    },
    scope: { ...scope },
    objects,
    metadata: {
      counts: countObjects(objects),
      warnings: [],
      unsupported: [],
      skipped: [],
    },
  };
}

export function finalizeBundle(bundle) {
  const objects = { ...emptyObjects(), ...(bundle.objects || {}) };
  return {
    ...bundle,
    objects,
    metadata: {
      counts: countObjects(objects),
      warnings: bundle.metadata?.warnings || [],
      unsupported: bundle.metadata?.unsupported || [],
      skipped: bundle.metadata?.skipped || [],
      ...(bundle.metadata?.ticket_filter ? { ticket_filter: bundle.metadata.ticket_filter } : {}),
    },
  };
}

export function serializeBundle(bundle) {
  return JSON.stringify(finalizeBundle(bundle), null, 2);
}
