import { MigrationObjectType } from "./objectTypes";

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

export function displayNameFor(type, item) {
  const payload = item?.payload || item || {};
  if (type === MigrationObjectType.CUSTOM_OBJECT_FIELDS || type === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) {
    return payload.title || payload.key || item?.stable_key || "Untitled field";
  }
  if (type === MigrationObjectType.OMNICHANNEL_QUEUES) {
    return payload.name || item?.stable_key || "Untitled queue";
  }
  return payload.title || payload.name || payload.key || item?.display_name || item?.stable_key || "Untitled item";
}

export function stableKeyFor(type, item) {
  const payload = item?.payload || item || {};
  const metadata = item?.metadata || {};

  switch (type) {
    case MigrationObjectType.GROUPS:
      return lower(payload.name);
    case MigrationObjectType.TICKET_FIELDS:
      return payload.key ? `key:${lower(payload.key)}` : `title_type:${lower(payload.title)}:${lower(payload.type)}`;
    case MigrationObjectType.TICKET_FORMS:
      return lower(payload.name);
    case MigrationObjectType.MACROS:
    case MigrationObjectType.VIEWS:
    case MigrationObjectType.TICKET_TRIGGERS:
    case MigrationObjectType.AUTOMATIONS:
      return lower(payload.title);
    case MigrationObjectType.WEBHOOKS:
      return `${lower(payload.name)}|${lower(payload.endpoint)}`;
    case MigrationObjectType.CUSTOM_OBJECTS:
      return lower(payload.key || metadata.source_key);
    case MigrationObjectType.CUSTOM_OBJECT_FIELDS:
      return `${lower(metadata.object_key || payload.object_key)}|${lower(payload.key)}`;
    case MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS:
      return `${lower(metadata.source_object_key || metadata.object_key || payload.object_key)}|${lower(payload.key)}`;
    case MigrationObjectType.CUSTOM_OBJECT_TRIGGERS:
      return `${lower(metadata.object_key)}|${lower(payload.title)}`;
    case MigrationObjectType.OMNICHANNEL_QUEUES:
      return lower(payload.name);
    case MigrationObjectType.ROUTING_SETTINGS:
      return "routing_settings";
    case MigrationObjectType.TICKETS:
      return lower(payload.external_id || metadata.source_id || payload.subject);
    default:
      return lower(payload.key || payload.title || payload.name);
  }
}

function targetStableKeyFor(type, target) {
  return stableKeyFor(type, {
    payload: target,
    metadata: {
      object_key: target?.object_key || target?.custom_object_key,
      source_object_key: target?.source_object_key || target?.custom_object_key,
    },
  });
}

export function findMatch(type, sourceItem, targetItems = []) {
  const sourceKey = stableKeyFor(type, sourceItem);
  if (!sourceKey) return null;

  return targetItems.find((target) => targetStableKeyFor(type, target) === sourceKey) || null;
}

export function buildTargetIndex(type, targetItems = []) {
  return targetItems.reduce((index, item) => {
    const key = targetStableKeyFor(type, item);
    if (key) index.set(key, item);
    return index;
  }, new Map());
}
