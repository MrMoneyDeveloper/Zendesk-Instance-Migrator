import { createEmptyBundle, finalizeBundle } from "./bundleBuilder";
import { getEndpoint } from "./endpoints";
import { MigrationObjectType, MIGRATION_OBJECT_ORDER } from "./objectTypes";
import { createReferenceMapper, REF_TYPES } from "./referenceMapper";
import { normalizeTicketForImport, ticketCommentAttachmentMetadata } from "./ticketPayload";
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

function helpCenterContext(type, source, context) {
  if (type === MigrationObjectType.HELP_CENTER_SECTIONS) {
    return {
      ...context,
      source_category_id: source?.category_id ?? null,
    };
  }
  if (type === MigrationObjectType.HELP_CENTER_ARTICLES) {
    return {
      ...context,
      source_section_id: source?.section_id ?? null,
    };
  }
  return context;
}

export function normalizeForBundle(type, source, context = {}) {
  const normalizedContext = helpCenterContext(type, source, context);
  const metadata = metadataFromSource(source, {
    object_key: normalizedContext.objectKey,
    source_object_key: normalizedContext.sourceObjectKey || normalizedContext.objectKey,
    exported_collection: normalizedContext.collectionKey,
    ...(normalizedContext.source_category_id !== undefined ? { source_category_id: normalizedContext.source_category_id } : {}),
    ...(normalizedContext.source_section_id !== undefined ? { source_section_id: normalizedContext.source_section_id } : {}),
  });

  const warnings = [];
  if (type === MigrationObjectType.TICKETS) {
    const payload = normalizeTicketForImport(source, {
      comments: normalizedContext.comments || [],
      sourceSubdomain: normalizedContext.sourceSubdomain || "",
    });
    const commentAttachments = (normalizedContext.comments || []).reduce((count, comment) => count + (Array.isArray(comment?.attachments) ? comment.attachments.length : 0), 0);
    if (commentAttachments > 0) {
      warnings.push("Ticket comment attachments were not embedded because Zendesk ticket imports require fresh upload tokens.");
    }
    return {
      stable_key: payload.external_id || String(metadata.source_id || ""),
      display_name: displayValue(payload),
      active: true,
      payload,
      metadata: {
        ...metadata,
        ticket_channel: source?.via?.channel || source?.channel || "",
        comment_count: Array.isArray(payload.comments) ? payload.comments.length : 0,
        attachment_count: commentAttachments,
      },
      warnings,
    };
  }

  const payload =
    type === MigrationObjectType.WEBHOOKS
      ? sanitizeWebhookPayload(source)
      : sanitizePayload(source, { stripSecrets: true });

  removeOrderFromPayload(type, payload);
  if (type === MigrationObjectType.TICKET_FORMS) {
    preserveTicketFormConditionIds(source, payload);
  }

  if (normalizedContext.objectKey && !payload.object_key) {
    payload.object_key = normalizedContext.objectKey;
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

function appendWarning(bundle, warning) {
  if (!warning) return;
  bundle.metadata.warnings.push(warning);
}

async function safeReadWrapped(api, type, path, wrapperKey, log, cache = null) {
  try {
    log?.(`Reading ${type} from ${path}`);
    if (cache?.has(path)) return { ok: true, item: cache.get(path) };
    const { data } = await api.request({ path, method: "GET" });
    const item = data?.[wrapperKey] || data;
    if (cache) cache.set(path, item);
    return { ok: true, item };
  } catch (error) {
    return {
      ok: false,
      item: null,
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

const GROUP_DEPENDENCY_TYPES = [
  MigrationObjectType.MACROS,
  MigrationObjectType.VIEWS,
  MigrationObjectType.TICKET_TRIGGERS,
  MigrationObjectType.AUTOMATIONS,
  MigrationObjectType.CUSTOM_OBJECT_TRIGGERS,
  MigrationObjectType.OMNICHANNEL_QUEUES,
  MigrationObjectType.ROUTING_SETTINGS,
];

function sourceIdKey(value) {
  return String(value ?? "").trim();
}

function existingSourceIds(items = []) {
  return new Set(
    items
      .map((item) => sourceIdKey(item?.metadata?.source_id))
      .filter(Boolean),
  );
}

function collectReferencedGroupIds(bundle) {
  const mapper = createReferenceMapper();
  const ids = new Set();

  for (const type of GROUP_DEPENDENCY_TYPES) {
    for (const item of bundle.objects?.[type] || []) {
      for (const ref of mapper.collectReferences(item.payload || {})) {
        if (ref.type === REF_TYPES.GROUP) {
          const value = sourceIdKey(ref.value);
          if (value) ids.add(value);
        }
      }
    }
  }

  return ids;
}

async function includeReferencedGroups({ api, bundle, options, log, cache }) {
  const referencedGroupIds = collectReferencedGroupIds(bundle);
  if (referencedGroupIds.size === 0) return;

  const presentGroupIds = existingSourceIds(bundle.objects[MigrationObjectType.GROUPS]);
  const missingGroupIds = [...referencedGroupIds].filter((id) => !presentGroupIds.has(id));
  if (missingGroupIds.length === 0) return;

  log?.(`Reading ${missingGroupIds.length} group dependencies required by exported rules.`);

  for (const groupId of missingGroupIds) {
    const path = `/api/v2/groups/${encodeURIComponent(groupId)}.json`;
    const result = await safeReadWrapped(api, MigrationObjectType.GROUPS, path, "group", log, cache);
    if (!result.ok || !result.item) {
      appendWarning(
        bundle,
        `Group dependency ${groupId} was referenced by an exported rule but could not be read from the source instance. Dependent items may be blocked during import.`,
      );
      appendSkipped(bundle, {
        object_type: MigrationObjectType.GROUPS,
        display_name: groupId,
        reason: "missing_required_group_dependency",
      });
      continue;
    }

    if (!options.includeInactive && isInactive(result.item)) {
      appendWarning(
        bundle,
        `Inactive group dependency "${displayValue(result.item)}" was included because an exported rule references it.`,
      );
    }

    const normalized = normalizeForBundle(MigrationObjectType.GROUPS, result.item, {
      collectionKey: getEndpoint(MigrationObjectType.GROUPS).collectionKey,
    });
    normalized.metadata.required_dependency = true;
    normalized.warnings = [
      ...(normalized.warnings || []),
      "Included automatically because another exported item references this group.",
    ];
    bundle.objects[MigrationObjectType.GROUPS].push(normalized);
    presentGroupIds.add(sourceIdKey(normalized.metadata.source_id));
  }
}

function collectTicketUserIds(ticket, comments = []) {
  const ids = new Set();
  for (const field of ["requester_id", "submitter_id", "assignee_id"]) {
    if (ticket?.[field] !== undefined && ticket?.[field] !== null) ids.add(String(ticket[field]));
  }
  for (const comment of comments) {
    if (comment?.author_id !== undefined && comment?.author_id !== null) ids.add(String(comment.author_id));
  }
  return [...ids];
}

async function collectFullTicketMetadata({ api, ticket, comments, log, cache }) {
  const users = {};
  const organizations = {};
  const attachments_by_comment_index = {};

  for (const userId of collectTicketUserIds(ticket, comments)) {
    const result = await safeReadWrapped(api, MigrationObjectType.TICKETS, `/api/v2/users/${encodeURIComponent(userId)}.json`, "user", log, cache);
    if (result.ok && result.item) {
      users[userId] = {
        id: result.item.id,
        name: result.item.name || "",
        email: result.item.email || "",
        role: result.item.role || "end-user",
      };
    }
  }

  if (ticket?.organization_id !== undefined && ticket?.organization_id !== null) {
    const orgId = String(ticket.organization_id);
    const result = await safeReadWrapped(api, MigrationObjectType.TICKETS, `/api/v2/organizations/${encodeURIComponent(orgId)}.json`, "organization", log, cache);
    if (result.ok && result.item) {
      organizations[orgId] = {
        id: result.item.id,
        name: result.item.name || "",
        external_id: result.item.external_id || "",
      };
    }
  }

  comments.forEach((comment, index) => {
    const attachments = ticketCommentAttachmentMetadata(comment);
    if (attachments.length > 0) attachments_by_comment_index[index] = attachments;
  });

  return { users, organizations, attachments_by_comment_index };
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

function parseTicketDate(value, endOfDay = false) {
  const text = String(value || "").trim();
  if (!text) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const parsed = new Date(`${text}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeTicketDateFilter(options = {}) {
  const mode = "date_range";
  const range = options.ticketDateRange || {};
  const from = String(range.from || "").trim();
  const to = String(range.to || "").trim();

  const fromDate = parseTicketDate(from, false);
  const toDate = parseTicketDate(to, true);
  return { mode, from, to, fromDate, toDate };
}

function isTicketInsideDateFilter(ticket, filter) {
  if (!filter || filter.mode !== "date_range") return true;
  const createdAt = new Date(ticket?.created_at || "");
  if (Number.isNaN(createdAt.getTime())) return false;
  if (filter.fromDate && createdAt < filter.fromDate) return false;
  if (filter.toDate && createdAt > filter.toDate) return false;
  return true;
}

function ticketFilterMetadata(filter) {
  if (!filter || filter.mode !== "date_range") return { mode: "all" };
  return {
    mode: "created_at_date_range",
    from: filter.from || "",
    to: filter.to || "",
  };
}

function uniqueCleanList(values, { lower = true } = {}) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .map((value) => (lower ? value.toLowerCase() : value)),
    ),
  ];
}

function normalizeCustomFieldFilters(filters) {
  return (Array.isArray(filters) ? filters : [])
    .map((filter) => ({
      field: String(filter?.field || "").trim(),
      value: Array.isArray(filter?.value)
        ? uniqueCleanList(filter.value, { lower: false })
        : String(filter?.value ?? "").trim(),
      title: String(filter?.title || "").trim(),
      key: String(filter?.key || "").trim(),
      type: String(filter?.type || "").trim(),
    }))
    .filter((filter) => filter.field && (Array.isArray(filter.value) ? filter.value.length > 0 : String(filter.value).trim()));
}

function normalizeTicketFieldFilters(options = {}) {
  const filters = options.ticketFilters || {};
  const commentMode = String(filters.commentMode || "all").trim().toLowerCase();
  return {
    channels: uniqueCleanList(filters.channels),
    statuses: uniqueCleanList(filters.statuses),
    types: uniqueCleanList(filters.types),
    priorities: uniqueCleanList(filters.priorities),
    brandIds: uniqueCleanList(filters.brandIds, { lower: false }),
    groupIds: uniqueCleanList(filters.groupIds, { lower: false }),
    assigneeIds: uniqueCleanList(filters.assigneeIds, { lower: false }),
    requesterIds: uniqueCleanList(filters.requesterIds, { lower: false }),
    organizationIds: uniqueCleanList(filters.organizationIds, { lower: false }),
    ticketFormIds: uniqueCleanList(filters.ticketFormIds, { lower: false }),
    tags: uniqueCleanList(filters.tags),
    commentMode: ["public", "internal", "both"].includes(commentMode) ? commentMode : "all",
    customFieldFilters: normalizeCustomFieldFilters(filters.customFieldFilters),
  };
}

function ticketChannelBucket(ticket) {
  const channel = String(ticket?.via?.channel || ticket?.channel || "").trim().toLowerCase();
  if (!channel) return "other";
  if (channel === "email") return "email";
  if (["web", "web_form", "help_center", "end_user"].includes(channel)) return "web";
  if (["api", "rest_api"].includes(channel)) return "api";
  if (["chat", "live_chat"].includes(channel)) return "chat";
  if (["messaging", "native_messaging", "sunshine_conversations", "whatsapp", "facebook_messenger"].includes(channel)) return "messaging";
  if (["voice", "phone", "talk", "voicemail"].includes(channel)) return "voice";
  if (["twitter", "facebook", "instagram", "social"].includes(channel)) return "social";
  if (["sms", "text"].includes(channel)) return "sms";
  return "other";
}

function matchesSelected(values, actual) {
  if (!values.length) return true;
  return values.includes(String(actual || "").trim().toLowerCase());
}

function matchesSelectedId(values, actual) {
  if (!values.length) return true;
  return values.includes(String(actual ?? "").trim());
}

function ticketMatchesTags(ticket, selectedTags) {
  if (!selectedTags.length) return true;
  const ticketTags = new Set((Array.isArray(ticket?.tags) ? ticket.tags : []).map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean));
  return selectedTags.every((tag) => ticketTags.has(tag));
}

function customFieldValue(ticket, fieldKey) {
  const fields = Array.isArray(ticket?.custom_fields) ? ticket.custom_fields : [];
  const wanted = String(fieldKey || "").trim();
  const match = fields.find((field) => String(field?.id || "") === wanted || String(field?.key || "") === wanted);
  if (!match) return undefined;
  return match.value;
}

function valuesMatch(actual, expected) {
  if (Array.isArray(expected)) {
    return expected.every((value) => valuesMatch(actual, value));
  }
  if (Array.isArray(actual)) {
    return actual.some((value) => valuesMatch(value, expected));
  }
  return String(actual ?? "").trim().toLowerCase() === String(expected ?? "").trim().toLowerCase();
}

function ticketMatchesCustomFieldFilters(ticket, filters) {
  return filters.every((filter) => valuesMatch(customFieldValue(ticket, filter.field), filter.value));
}

function isTicketInsideFieldFilters(ticket, filters) {
  if (!matchesSelected(filters.channels, ticketChannelBucket(ticket))) return false;
  if (!matchesSelected(filters.statuses, ticket?.status)) return false;
  if (!matchesSelected(filters.types, ticket?.type)) return false;
  if (!matchesSelected(filters.priorities, ticket?.priority)) return false;
  if (!matchesSelectedId(filters.brandIds, ticket?.brand_id)) return false;
  if (!matchesSelectedId(filters.groupIds, ticket?.group_id)) return false;
  if (!matchesSelectedId(filters.assigneeIds, ticket?.assignee_id)) return false;
  if (!matchesSelectedId(filters.requesterIds, ticket?.requester_id)) return false;
  if (!matchesSelectedId(filters.organizationIds, ticket?.organization_id)) return false;
  if (!matchesSelectedId(filters.ticketFormIds, ticket?.ticket_form_id)) return false;
  if (!ticketMatchesTags(ticket, filters.tags)) return false;
  if (!ticketMatchesCustomFieldFilters(ticket, filters.customFieldFilters)) return false;
  return true;
}

function isTicketInsideCommentFilter(comments, commentMode) {
  if (commentMode === "all") return true;
  const hasPublic = comments.some((comment) => comment?.public !== false);
  const hasInternal = comments.some((comment) => comment?.public === false);
  if (commentMode === "public") return hasPublic;
  if (commentMode === "internal") return hasInternal;
  if (commentMode === "both") return hasPublic && hasInternal;
  return true;
}

function fieldFilterMetadata(filters) {
  return {
    channels: filters.channels,
    statuses: filters.statuses,
    types: filters.types,
    priorities: filters.priorities,
    brand_ids: filters.brandIds,
    group_ids: filters.groupIds,
    assignee_ids: filters.assigneeIds,
    requester_ids: filters.requesterIds,
    organization_ids: filters.organizationIds,
    ticket_form_ids: filters.ticketFormIds,
    tags: filters.tags,
    comment_mode: filters.commentMode,
    custom_field_filters: filters.customFieldFilters.map((filter) => {
      const metadata = {
        field: filter.field,
        value: filter.value,
      };
      if (filter.title) metadata.title = filter.title;
      if (filter.key) metadata.key = filter.key;
      if (filter.type) metadata.type = filter.type;
      return metadata;
    }),
  };
}

function hasSelectedTicketFilters(filters) {
  return Boolean(
    filters.channels.length ||
      filters.statuses.length ||
      filters.types.length ||
      filters.priorities.length ||
      filters.brandIds.length ||
      filters.groupIds.length ||
      filters.assigneeIds.length ||
      filters.requesterIds.length ||
      filters.organizationIds.length ||
      filters.ticketFormIds.length ||
      filters.tags.length ||
      filters.customFieldFilters.length ||
      filters.commentMode !== "all",
  );
}

async function exportTickets({ api, bundle, options, log, cache, sourceSubdomain }) {
  const endpoint = getEndpoint(MigrationObjectType.TICKETS);
  const dateFilter = normalizeTicketDateFilter(options);
  const fieldFilters = normalizeTicketFieldFilters(options);
  bundle.metadata.ticket_filter = {
    ...ticketFilterMetadata(dateFilter),
    ...fieldFilterMetadata(fieldFilters),
  };
  if (dateFilter.mode === "date_range") {
    const fromLabel = dateFilter.from || "beginning";
    const toLabel = dateFilter.to || "now";
    log?.(`Exporting tickets created from ${fromLabel} to ${toLabel}.`);
  } else {
    log?.("Exporting all tickets.");
  }
  if (hasSelectedTicketFilters(fieldFilters)) {
    log?.("Applying selected ticket filters before adding tickets to the bundle.");
  }

  const result = await safeFetchAll(api, MigrationObjectType.TICKETS, endpoint.listPath, endpoint.collectionKey, log, cache);
  if (!result.ok) {
    appendUnsupported(bundle, result.error);
    return;
  }

  for (const ticket of result.items) {
    if (!isTicketInsideDateFilter(ticket, dateFilter)) {
      appendSkipped(bundle, {
        object_type: MigrationObjectType.TICKETS,
        display_name: displayValue(ticket),
        reason: "outside_created_at_range",
      });
      continue;
    }

    if (!isTicketInsideFieldFilters(ticket, fieldFilters)) {
      appendSkipped(bundle, {
        object_type: MigrationObjectType.TICKETS,
        display_name: displayValue(ticket),
        reason: "outside_ticket_filters",
      });
      continue;
    }

    if (!options.includeInactive && isInactive(ticket)) {
      appendSkipped(bundle, {
        object_type: MigrationObjectType.TICKETS,
        display_name: displayValue(ticket),
        reason: "inactive_excluded",
      });
      continue;
    }

    const ticketId = ticket?.id;
    let comments = [];
    if (ticketId !== undefined && ticketId !== null) {
      const commentsPath = `/api/v2/tickets/${encodeURIComponent(ticketId)}/comments.json`;
      const commentsResult = await safeFetchAll(api, MigrationObjectType.TICKETS, commentsPath, "comments", log, cache);
      if (commentsResult.ok) {
        comments = commentsResult.items;
      } else {
        appendUnsupported(bundle, commentsResult.error);
      }
    }

    if (!isTicketInsideCommentFilter(comments, fieldFilters.commentMode)) {
      appendSkipped(bundle, {
        object_type: MigrationObjectType.TICKETS,
        display_name: displayValue(ticket),
        reason: "outside_comment_filter",
      });
      continue;
    }

    const normalized = normalizeForBundle(MigrationObjectType.TICKETS, ticket, {
      comments,
      collectionKey: endpoint.collectionKey,
      sourceSubdomain,
    });
    normalized.metadata.full_ticket_migration = await collectFullTicketMetadata({ api, ticket, comments, log, cache });
    bundle.objects[MigrationObjectType.TICKETS].push(normalized);
  }

  bundle.metadata.warnings.push(
    "Tickets were exported for best-effort import. Full ticket migration can map/create users and organizations and fetch attachment binaries during import when source credentials are provided. Audit history, metrics, and SLAs are not migrated by this app.",
  );
  log?.(`Exported ${bundle.objects[MigrationObjectType.TICKETS].length} tickets with importable comments.`);
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

    if (type === MigrationObjectType.TICKETS) {
      await exportTickets({ api, bundle, options: { ...options, includeInactive }, log, cache: exportCache, sourceSubdomain: source.subdomain });
      continue;
    }

    await exportSimpleType({ api, bundle, type, options: { includeInactive }, log, cache: exportCache });
  }

  await includeReferencedGroups({ api, bundle, options: { includeInactive }, log, cache: exportCache });

  const finalized = finalizeBundle(bundle);
  log("Export complete. Treat this bundle as confidential because it contains business rules and internal configuration.");
  return finalized;
}
