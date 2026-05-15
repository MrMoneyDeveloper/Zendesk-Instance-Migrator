import { MigrationObjectType } from "./objectTypes";

const REF_TYPES = Object.freeze({
  GROUP: "group",
  TICKET_FIELD: "ticket_field",
  TICKET_FORM: "ticket_form",
  WEBHOOK: "webhook",
  CUSTOM_OBJECT: "custom_object",
  CUSTOM_OBJECT_FIELD: "custom_object_field",
  QUEUE: "queue",
});
const ZENDESK_SPECIAL_VALUES = new Set(["", "current_user", "current_groups", "requester", "requester_id", "requester_and_ccs", "assignee_id"]);
function isSpecialZendeskValue(value) {
  return ZENDESK_SPECIAL_VALUES.has(String(value ?? ""));
}
function isWebhookActionField(field) {
  return String(field || "") === "notification_webhook";
}

function key(value) {
  return String(value ?? "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function sourceIdFor(item) {
  return item?.metadata?.source_id;
}

function targetIdFor(type, target) {
  if (!target) return null;
  if (type === MigrationObjectType.CUSTOM_OBJECTS) return target.key;
  if (type === MigrationObjectType.CUSTOM_OBJECT_FIELDS || type === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) return target.key;
  if (type === MigrationObjectType.OMNICHANNEL_QUEUES) return target.id || target.name;
  return target.id;
}

function mapTypeForObjectType(type) {
  switch (type) {
    case MigrationObjectType.GROUPS:
      return REF_TYPES.GROUP;
    case MigrationObjectType.TICKET_FIELDS:
      return REF_TYPES.TICKET_FIELD;
    case MigrationObjectType.TICKET_FORMS:
      return REF_TYPES.TICKET_FORM;
    case MigrationObjectType.WEBHOOKS:
      return REF_TYPES.WEBHOOK;
    case MigrationObjectType.CUSTOM_OBJECTS:
      return REF_TYPES.CUSTOM_OBJECT;
    case MigrationObjectType.CUSTOM_OBJECT_FIELDS:
    case MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS:
      return REF_TYPES.CUSTOM_OBJECT_FIELD;
    case MigrationObjectType.OMNICHANNEL_QUEUES:
      return REF_TYPES.QUEUE;
    default:
      return null;
  }
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, (child, path) => visitor(child, [index, ...path])));
    return;
  }

  if (!value || typeof value !== "object") return;

  visitor(value, []);
  Object.values(value).forEach((entry) => walk(entry, visitor));
}

function collectKnownSourceIds(bundle) {
  const known = {
    [REF_TYPES.GROUP]: new Set(),
    [REF_TYPES.TICKET_FIELD]: new Set(),
    [REF_TYPES.TICKET_FORM]: new Set(),
    [REF_TYPES.WEBHOOK]: new Set(),
    [REF_TYPES.CUSTOM_OBJECT]: new Set(),
    [REF_TYPES.CUSTOM_OBJECT_FIELD]: new Set(),
    [REF_TYPES.QUEUE]: new Set(),
  };

  for (const [objectType, items] of Object.entries(bundle?.objects || {})) {
    const refType = mapTypeForObjectType(objectType);
    if (!refType || !Array.isArray(items)) continue;

    for (const item of items) {
      const sourceId = sourceIdFor(item);
      if (sourceId !== undefined && sourceId !== null) known[refType].add(key(sourceId));
      if (objectType === MigrationObjectType.CUSTOM_OBJECTS && item?.payload?.key) known[refType].add(key(item.payload.key));
      if (
        (objectType === MigrationObjectType.CUSTOM_OBJECT_FIELDS ||
          objectType === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) &&
        item?.payload?.key
      ) {
        known[refType].add(key(`${item?.metadata?.object_key || item?.payload?.object_key}:${item.payload.key}`));
      }
    }
  }

  return known;
}

export class ReferenceMapper {
  constructor(bundle = null) {
    this.maps = {
      [REF_TYPES.GROUP]: new Map(),
      [REF_TYPES.TICKET_FIELD]: new Map(),
      [REF_TYPES.TICKET_FORM]: new Map(),
      [REF_TYPES.WEBHOOK]: new Map(),
      [REF_TYPES.CUSTOM_OBJECT]: new Map(),
      [REF_TYPES.CUSTOM_OBJECT_FIELD]: new Map(),
      [REF_TYPES.QUEUE]: new Map(),
    };
    this.knownSourceIds = bundle ? collectKnownSourceIds(bundle) : null;
  }

  register(type, sourceValue, targetValue) {
    if (sourceValue === undefined || sourceValue === null || targetValue === undefined || targetValue === null) return;
    this.maps[type]?.set(key(sourceValue), targetValue);
  }

  registerObjectResult(objectType, sourceItem, targetItem) {
    const refType = mapTypeForObjectType(objectType);
    if (!refType) return;

    const sourceId = sourceIdFor(sourceItem);
    const targetId = targetIdFor(objectType, targetItem);
    this.register(refType, sourceId, targetId);

    if (objectType === MigrationObjectType.CUSTOM_OBJECTS) {
      const objectKey = sourceItem?.payload?.key || targetItem?.key;
      this.register(refType, objectKey, targetItem?.key || objectKey);
    }

    if (objectType === MigrationObjectType.CUSTOM_OBJECT_FIELDS || objectType === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) {
      const objectKey = sourceItem?.metadata?.object_key || sourceItem?.payload?.object_key || targetItem?.object_key;
      const fieldKey = sourceItem?.payload?.key || targetItem?.key;
      this.register(refType, `${objectKey}:${fieldKey}`, targetItem?.key || fieldKey);
    }

    if (objectType === MigrationObjectType.OMNICHANNEL_QUEUES) {
      this.register(refType, sourceItem?.payload?.name, targetItem?.id || targetItem?.name);
    }
  }

  lookup(type, sourceValue) {
    return this.maps[type]?.get(key(sourceValue));
  }

  hasKnownSource(type, sourceValue) {
    if (!this.knownSourceIds) return false;
    return this.knownSourceIds[type]?.has(key(sourceValue)) || false;
  }

  collectReferences(payload) {
    const refs = [];

    walk(payload, (node) => {
      if (!node || typeof node !== "object") return;

      for (const value of asArray(node.group_id)) refs.push({ type: REF_TYPES.GROUP, value, label: "group_id" });
      for (const value of asArray(node.group_ids)) refs.push({ type: REF_TYPES.GROUP, value, label: "group_ids" });
      if (Array.isArray(node.groups)) {
        for (const group of node.groups) {
          if (group?.id !== undefined) refs.push({ type: REF_TYPES.GROUP, value: group.id, label: "queue group" });
        }
      }
      for (const value of asArray(node.ticket_field_id)) refs.push({ type: REF_TYPES.TICKET_FIELD, value, label: "ticket_field_id" });
      for (const value of asArray(node.ticket_field_ids)) refs.push({ type: REF_TYPES.TICKET_FIELD, value, label: "ticket_field_ids" });
      for (const value of asArray(node.parent_field_id)) refs.push({ type: REF_TYPES.TICKET_FIELD, value, label: "parent_field_id" });
      if (Array.isArray(node.child_fields)) {
        for (const child of node.child_fields) {
          if (child?.id !== undefined) refs.push({ type: REF_TYPES.TICKET_FIELD, value: child.id, label: "child_fields.id" });
        }
      }
      for (const value of asArray(node.ticket_form_id)) refs.push({ type: REF_TYPES.TICKET_FORM, value, label: "ticket_form_id" });
      for (const value of asArray(node.webhook_id)) refs.push({ type: REF_TYPES.WEBHOOK, value, label: "webhook_id" });
      for (const value of asArray(node.queue_id)) refs.push({ type: REF_TYPES.QUEUE, value, label: "queue_id" });

      const field = String(node.field || "");
      const value = node.value;
      if (field === "group_id") refs.push(...asArray(value).map((entry) => ({ type: REF_TYPES.GROUP, value: entry, label: "condition group_id" })));
      if (field === "ticket_form_id") {
        refs.push(...asArray(value).map((entry) => ({ type: REF_TYPES.TICKET_FORM, value: entry, label: "condition ticket_form_id" })));
      }
      if (isWebhookActionField(field)) {
        if (Array.isArray(value) && value.length > 0) {
          refs.push({ type: REF_TYPES.WEBHOOK, value: value[0], label: "notification_webhook.id" });
        }
      }

      const ticketFieldMatch = field.match(/(?:ticket_field|custom_fields?)_(\d+)/);
      if (ticketFieldMatch) {
        refs.push({ type: REF_TYPES.TICKET_FIELD, value: ticketFieldMatch[1], label: field });
      }
    });

    return refs.filter((ref) => ref.value !== undefined && ref.value !== null && !isSpecialZendeskValue(ref.value));
  }

  findMissingReferences(payload) {
    return this.collectReferences(payload).filter((ref) => {
      if (this.lookup(ref.type, ref.value)) return false;
      return !this.hasKnownSource(ref.type, ref.value);
    });
  }

  rewritePayload(payload) {
    const missing = [];
    const rewritten = structuredClone(payload || {});

    const rewriteScalar = (type, value, label) => {
      if (value === undefined || value === null || value === "" || isSpecialZendeskValue(value)) return value;
      const mapped = this.lookup(type, value);
      if (mapped !== undefined) return mapped;
      if (this.hasKnownSource(type, value)) {
        missing.push({ type, value, label, reason: "dependency_not_created_yet" });
      }
      return value;
    };

    const rewriteArray = (type, values, label) => asArray(values).map((value) => rewriteScalar(type, value, label));
    const rewriteMaybeArray = (type, value, label) =>
      Array.isArray(value) ? rewriteArray(type, value, label) : rewriteScalar(type, value, label);

    walk(rewritten, (node) => {
      if (!node || typeof node !== "object") return;

      if (node.group_id !== undefined) node.group_id = rewriteScalar(REF_TYPES.GROUP, node.group_id, "group_id");
      if (node.group_ids !== undefined) node.group_ids = rewriteArray(REF_TYPES.GROUP, node.group_ids, "group_ids");
      if (Array.isArray(node.groups)) {
        node.groups = node.groups.map((group) =>
          group && typeof group === "object"
            ? { ...group, id: rewriteScalar(REF_TYPES.GROUP, group.id, "queue group") }
            : group,
        );
      }
      if (node.ticket_field_id !== undefined) node.ticket_field_id = rewriteScalar(REF_TYPES.TICKET_FIELD, node.ticket_field_id, "ticket_field_id");
      if (node.ticket_field_ids !== undefined) node.ticket_field_ids = rewriteArray(REF_TYPES.TICKET_FIELD, node.ticket_field_ids, "ticket_field_ids");
      if (node.parent_field_id !== undefined) node.parent_field_id = rewriteScalar(REF_TYPES.TICKET_FIELD, node.parent_field_id, "parent_field_id");
      if (Array.isArray(node.child_fields)) {
        node.child_fields = node.child_fields.map((child) =>
          child && typeof child === "object"
            ? { ...child, id: rewriteScalar(REF_TYPES.TICKET_FIELD, child.id, "child_fields.id") }
            : child,
        );
      }
      if (node.ticket_form_id !== undefined) node.ticket_form_id = rewriteScalar(REF_TYPES.TICKET_FORM, node.ticket_form_id, "ticket_form_id");
      if (node.webhook_id !== undefined) node.webhook_id = rewriteScalar(REF_TYPES.WEBHOOK, node.webhook_id, "webhook_id");
      if (node.queue_id !== undefined) node.queue_id = rewriteScalar(REF_TYPES.QUEUE, node.queue_id, "queue_id");

      if (node.field !== undefined) {
        let field = String(node.field);
        field = field.replace(/(ticket_field|custom_fields?)_(\d+)/, (match, prefix, sourceId) => {
          const mapped = this.lookup(REF_TYPES.TICKET_FIELD, sourceId);
          if (mapped === undefined) {
            if (this.hasKnownSource(REF_TYPES.TICKET_FIELD, sourceId)) {
              missing.push({ type: REF_TYPES.TICKET_FIELD, value: sourceId, label: field, reason: "dependency_not_created_yet" });
            }
            return match;
          }
          return `${prefix}_${mapped}`;
        });
        node.field = field;
      }

      if (node.field === "group_id") node.value = rewriteMaybeArray(REF_TYPES.GROUP, node.value, "condition group_id");
      if (node.field === "ticket_form_id") node.value = rewriteMaybeArray(REF_TYPES.TICKET_FORM, node.value, "condition ticket_form_id");
      if (isWebhookActionField(node.field) && Array.isArray(node.value)) {
        node.value = [rewriteScalar(REF_TYPES.WEBHOOK, node.value[0], "notification_webhook.id"), ...node.value.slice(1)];
      }
      if (node.restriction && node.restriction.type === "Group" && Array.isArray(node.restriction.ids)) {
        node.restriction.ids = rewriteArray(REF_TYPES.GROUP, node.restriction.ids, "restriction.ids");
      }
      if (node.required_on_statuses && typeof node.required_on_statuses === "object") {
        delete node.required_on_statuses.custom_statuses;
      }
    });

    return { payload: rewritten, missing };
  }
}

export function createReferenceMapper(bundle) {
  return new ReferenceMapper(bundle);
}

export { REF_TYPES };
export { isSpecialZendeskValue };
