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
  if (type === MigrationObjectType.HELP_CENTER_CATEGORIES || type === MigrationObjectType.HELP_CENTER_SECTIONS) {
    return payload.name || payload.title || item?.stable_key || "Untitled item";
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
    case MigrationObjectType.HELP_CENTER_CATEGORIES:
      return lower(payload.name || payload.title);
    case MigrationObjectType.HELP_CENTER_SECTIONS:
      return `${lower(metadata.match_category_name ?? payload.category_name ?? metadata.match_category_id ?? metadata.source_category_id ?? payload.category_id)}|${lower(payload.name || payload.title)}`;
    case MigrationObjectType.HELP_CENTER_ARTICLES:
      return `${lower(metadata.match_section_path ?? metadata.match_section_name ?? payload.section_name ?? metadata.match_section_id ?? metadata.source_section_id ?? payload.section_id)}|${lower(payload.title || payload.name)}`;
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
      match_category_id: target?.category_id,
      match_section_id: target?.section_id,
      match_category_name: target?.match_category_name || target?.category_name,
      match_section_name: target?.match_section_name || target?.section_name,
      match_section_path: target?.match_section_path,
    },
  });
}

export function findMatch(type, sourceItem, targetItems = []) {
  const sourceKey = stableKeyFor(type, sourceItem);
  if (!sourceKey) return null;

  return targetItems.find((target) => targetStableKeyFor(type, target) === sourceKey) || null;
}

export function findMatches(type, sourceItem, targetItems = []) {
  const sourceKey = stableKeyFor(type, sourceItem);
  if (!sourceKey) return [];

  return targetItems.filter((target) => targetStableKeyFor(type, target) === sourceKey);
}

export function buildTargetIndex(type, targetItems = []) {
  return targetItems.reduce((index, item) => {
    const key = targetStableKeyFor(type, item);
    if (key) index.set(key, item);
    return index;
  }, new Map());
}
