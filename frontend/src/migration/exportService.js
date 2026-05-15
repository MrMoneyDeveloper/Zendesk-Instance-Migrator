import { createEmptyBundle, finalizeBundle } from "./bundleBuilder";
import { getEndpoint } from "./endpoints";
import { MigrationObjectType, MIGRATION_OBJECT_ORDER } from "./objectTypes";
import { metadataFromSource, sanitizePayload, sanitizeWebhookPayload, hasWebhookSecretRequirement } from "../utils/sanitizePayload";

function displayValue(source) {
  return source?.title || source?.name || source?.key || source?.id || "Untitled item";
}

function activeValue(source) {
  if (source?.active !== undefined) return source.active;
  if (source?.status) return String(source.status).toLowerCase() !== "inactive";
  return true;
}

function isInactive(source) {
  return activeValue(source) === false;
}

function isLookupRelationshipField(field) {
  const type = String(field?.type || field?.field_type || "").toLowerCase();
  return (
    type === "lookup" ||
    type === "lookup_relationship" ||
    Boolean(field?.relationship_target_type || field?.relationship_target_object || field?.lookup_relationship_target)
  );
}

function removeOrderFromPayload(type, payload) {
  if (
    type === MigrationObjectType.TICKET_TRIGGERS ||
    type === MigrationObjectType.AUTOMATIONS ||
    type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS
  ) {
    delete payload.position;
  }
  if (type !== MigrationObjectType.OMNICHANNEL_QUEUES) {
    delete payload.order;
  }
}

function endpointHost(endpoint) {
  try {
    return new URL(String(endpoint || "")).hostname;
  } catch {
    return "";
  }
}

function preserveTicketFormConditionIds(source, payload) {
  const copyConditions = (sourceList, payloadList) => {
    if (!Array.isArray(sourceList) || !Array.isArray(payloadList)) return;
    for (let index = 0; index < Math.min(sourceList.length, payloadList.length); index += 1) {
      const sourceCondition = sourceList[index] || {};
      const payloadCondition = payloadList[index] || {};
      if (sourceCondition.parent_field_id !== undefined) {
        payloadCondition.parent_field_id = sourceCondition.parent_field_id;
      }
      if (Array.isArray(sourceCondition.child_fields) && Array.isArray(payloadCondition.child_fields)) {
        for (let childIndex = 0; childIndex < Math.min(sourceCondition.child_fields.length, payloadCondition.child_fields.length); childIndex += 1) {
          const sourceChild = sourceCondition.child_fields[childIndex] || {};
          const payloadChild = payloadCondition.child_fields[childIndex] || {};
          if (sourceChild.id !== undefined) payloadChild.id = sourceChild.id;
          payloadCondition.child_fields[childIndex] = payloadChild;
        }
      }
      payloadList[index] = payloadCondition;
    }
  };

  copyConditions(source?.agent_conditions, payload?.agent_conditions);
  copyConditions(source?.end_user_conditions, payload?.end_user_conditions);
}

export function normalizeForBundle(type, source, context = {}) {
  const metadata = metadataFromSource(source, {
    object_key: context.objectKey,
    source_object_key: context.sourceObjectKey || context.objectKey,
    exported_collection: context.collectionKey,
  });

  const warnings = [];
  const payload =
    type === MigrationObjectType.WEBHOOKS
      ? sanitizeWebhookPayload(source)
      : sanitizePayload(source, { stripSecrets: true });

  removeOrderFromPayload(type, payload);
  if (type === MigrationObjectType.TICKET_FORMS) {
    preserveTicketFormConditionIds(source, payload);
  }

  if (context.objectKey && !payload.object_key) {
    payload.object_key = context.objectKey;
  }

  if (type === MigrationObjectType.WEBHOOKS) {
    metadata.requires_target_basic_auth = true;
    metadata.auth_strategy = "zendesk_basic_auth_token";
    metadata.source_endpoint_host = endpointHost(source?.endpoint || payload?.endpoint);
  }

  if (type === MigrationObjectType.WEBHOOKS && hasWebhookSecretRequirement(source)) {
    metadata.skipped_secret_required = true;
    warnings.push("Webhook requires manual secret reconfiguration after import through target Basic Auth setup.");
  }

  return {
    stable_key: payload.key || payload.title || payload.name || String(metadata.source_id || ""),
    display_name: displayValue(payload),
    active: activeValue(source),
    payload,
    metadata,
    warnings,
  };
}

async function safeFetchAll(api, type, path, collectionKey, log, cache = null) {
  try {
    log?.(`Reading ${type} from ${path}`);
    if (cache?.has(path)) {
      return {
        ok: true,
        items: cache.get(path),
      };
    }
    const items = await api.fetchAll(path, collectionKey);
    if (cache) cache.set(path, items);
    return {
      ok: true,
      items,
    };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: {
        object_type: type,
        reason: error?.code || "zendesk_api_error",
        message: error?.message || `${type} could not be read from the current instance.`,
        path,
        status: error?.status || null,
      },
    };
  }
}

async function safeReadSingleton(api, type, path, log) {
  try {
    log?.(`Reading ${type} from ${path}`);
    const { data } = await api.request({ path, method: "GET" });
    return {
      ok: true,
      items: data ? [data] : [],
    };
  } catch (error) {
    return {
      ok: false,
      items: [],
      error: {
        object_type: type,
        reason: error?.code || "zendesk_api_error",
        message: error?.message || `${type} could not be read from the current instance.`,
        path,
        status: error?.status || null,
      },
    };
  }
}

function appendUnsupported(bundle, unsupported) {
  if (!unsupported) return;
  bundle.metadata.unsupported.push(unsupported);
  bundle.metadata.warnings.push(`${unsupported.object_type}: ${unsupported.message}`);
}

function appendSkipped(bundle, skipped) {
  bundle.metadata.skipped.push(skipped);
}

function addNormalizedItems(bundle, type, rawItems, options, context = {}) {
  for (const raw of rawItems) {
    if (!options.includeInactive && isInactive(raw)) {
      appendSkipped(bundle, {
        object_type: type,
        display_name: displayValue(raw),
        reason: "inactive_excluded",
      });
      continue;
    }

    const normalized = normalizeForBundle(type, raw, context);
    bundle.objects[type].push(normalized);

    if (normalized.metadata.skipped_secret_required) {
      appendSkipped(bundle, {
        object_type: type,
        display_name: normalized.display_name,
        reason: "skipped_secret_required",
      });
    }
  }
}

async function exportSimpleType({ api, bundle, type, options, log, cache }) {
  const endpoint = getEndpoint(type);
  const result = await safeFetchAll(api, type, endpoint.listPath, endpoint.collectionKey, log, cache);
  if (!result.ok) {
    appendUnsupported(bundle, result.error);
    return;
  }

  addNormalizedItems(bundle, type, result.items, options, { collectionKey: endpoint.collectionKey });
  log?.(`Exported ${bundle.objects[type].length} ${type}.`);
}

async function readCustomObjectsForChildren({ api, bundle, options, log, cache }) {
  if (bundle.objects[MigrationObjectType.CUSTOM_OBJECTS].length > 0) {
    return bundle.objects[MigrationObjectType.CUSTOM_OBJECTS].map((item) => item.payload);
  }

  const endpoint = getEndpoint(MigrationObjectType.CUSTOM_OBJECTS);
  const result = await safeFetchAll(api, MigrationObjectType.CUSTOM_OBJECTS, endpoint.listPath, endpoint.collectionKey, log, cache);
  if (!result.ok) {
    appendUnsupported(bundle, result.error);
    return [];
  }

  return result.items.filter((item) => options.includeInactive || !isInactive(item));
}

async function exportCustomObjectFields({ api, bundle, scope, options, log, cache }) {
  const endpoint = getEndpoint(MigrationObjectType.CUSTOM_OBJECT_FIELDS);
  const objects = await readCustomObjectsForChildren({ api, bundle, options, log, cache });

  for (const object of objects) {
    const objectKey = object.key;
    if (!objectKey) continue;

    const path = endpoint.listPath(objectKey);
    const result = await safeFetchAll(api, MigrationObjectType.CUSTOM_OBJECT_FIELDS, path, endpoint.collectionKey, log, cache);
    if (!result.ok) {
      appendUnsupported(bundle, result.error);
      continue;
    }

    if (scope?.[MigrationObjectType.CUSTOM_OBJECT_FIELDS]) {
      const fields = result.items.filter((field) => !isLookupRelationshipField(field));
      addNormalizedItems(bundle, MigrationObjectType.CUSTOM_OBJECT_FIELDS, fields, options, { objectKey, collectionKey: endpoint.collectionKey });
    }

    if (scope?.[MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS]) {
      const relationships = result.items.filter((field) => isLookupRelationshipField(field));
      addNormalizedItems(bundle, MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS, relationships, options, {
        objectKey,
        sourceObjectKey: objectKey,
        collectionKey: endpoint.collectionKey,
      });
    }
  }
}

async function exportCustomObjectTriggers({ api, bundle, options, log, cache }) {
  const endpoint = getEndpoint(MigrationObjectType.CUSTOM_OBJECT_TRIGGERS);
  const objects = await readCustomObjectsForChildren({ api, bundle, options, log, cache });

  for (const object of objects) {
    const objectKey = object.key;
    if (!objectKey) continue;

    const path = endpoint.listPath(objectKey);
    const result = await safeFetchAll(api, MigrationObjectType.CUSTOM_OBJECT_TRIGGERS, path, endpoint.collectionKey, log, cache);
    if (!result.ok) {
      appendUnsupported(bundle, result.error);
      continue;
    }
    addNormalizedItems(bundle, MigrationObjectType.CUSTOM_OBJECT_TRIGGERS, result.items, options, {
      objectKey,
      collectionKey: endpoint.collectionKey,
    });
  }
}

async function exportRoutingSettings({ api, bundle, log }) {
  const endpoint = getEndpoint(MigrationObjectType.ROUTING_SETTINGS);
  const result = await safeReadSingleton(api, MigrationObjectType.ROUTING_SETTINGS, endpoint.listPath, log);

  if (!result.ok) {
    appendUnsupported(bundle, result.error);
    return;
  }

  addNormalizedItems(bundle, MigrationObjectType.ROUTING_SETTINGS, result.items, { includeInactive: true });
  bundle.metadata.warnings.push("Routing settings were exported as readable configuration only; import writes are skipped unless explicitly confirmed by endpoint support.");
}

export async function exportConfiguration({ api, startupState, scope, options = {}, onLog }) {
  const log = (message) => onLog?.(`${new Date().toLocaleTimeString()} ${message}`);
  const includeInactive = options.includeInactive === true;
  const source = {
    subdomain: startupState?.context?.subdomain || "",
    account_name: startupState?.context?.account_name || "",
    current_user_id: startupState?.currentUser?.id || null,
    current_user_email: startupState?.currentUser?.email || "",
  };

  const bundle = createEmptyBundle({ source, scope });
  const exportCache = new Map();
  log("Starting export from the current instance.");
  let customObjectFieldsRead = false;

  for (const type of MIGRATION_OBJECT_ORDER) {
    if (!scope?.[type]) continue;

    if (type === MigrationObjectType.CUSTOM_OBJECT_FIELDS || type === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) {
      if (!customObjectFieldsRead) {
        await exportCustomObjectFields({ api, bundle, scope, options: { includeInactive }, log, cache: exportCache });
        customObjectFieldsRead = true;
      }
      continue;
    }

    if (type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS) {
      await exportCustomObjectTriggers({ api, bundle, options: { includeInactive }, log, cache: exportCache });
      continue;
    }

    if (type === MigrationObjectType.ROUTING_SETTINGS) {
      await exportRoutingSettings({ api, bundle, log });
      continue;
    }

    await exportSimpleType({ api, bundle, type, options: { includeInactive }, log, cache: exportCache });
  }

  const finalized = finalizeBundle(bundle);
  log("Export complete. Treat this bundle as confidential because it contains business rules and internal configuration.");
  return finalized;
}
