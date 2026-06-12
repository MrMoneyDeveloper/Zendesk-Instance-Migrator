import { getEndpoint } from "./endpoints";
import { buildExecutionReport } from "./reportExporter";
import { orderPlanItems } from "./dependencyOrder";
import { MigrationObjectType } from "./objectTypes";
import { createReferenceMapper, REF_TYPES } from "./referenceMapper";
import { buildWebhookAuthentication } from "./webhookAuth";
import { createSourceZendeskClient, prepareFullTicketPayload } from "./fullTicketMigration";
import { rewriteZendeskWebhookEndpoint } from "./webhookEndpointRewrite";

function resultFromResponse(data, wrapperKey) {
  return data?.[wrapperKey] || data;
}

function isWriteAction(action) {
  return action === "CREATE" || action === "UPDATE";
}

function responseStatus(action) {
  if (action === "CREATE") return "created";
  if (action === "UPDATE") return "updated";
  if (action === "MANUAL_REQUIRED") return "manual_required";
  if (action === "REFERENCE_ONLY") return "skipped";
  if (action === "FAIL") return "failed";
  return "skipped";
}

function actionPastTense(action) {
  if (action === "CREATE") return "created";
  if (action === "UPDATE") return "updated";
  if (action === "SKIP") return "skipped";
  if (action === "MANUAL_REQUIRED") return "manual_required";
  if (action === "REFERENCE_ONLY") return "reference_only";
  return "failed";
}

function targetItemsForType(targetState, type) {
  return targetState?.[type] || [];
}

function findTargetById(targetState, type, targetId) {
  const id = String(targetId ?? "");
  return targetItemsForType(targetState, type).find((item) => String(item.id ?? item.key ?? item.name ?? "") === id);
}

function createOrUpdatePath(endpoint, action, planItem) {
  const item = planItem.source_item;
  const objectKey = item?.metadata?.object_key || item?.payload?.object_key;

  if (action === "CREATE") {
    return typeof endpoint.createPath === "function" ? endpoint.createPath(objectKey) : endpoint.createPath;
  }

  if (!planItem.target_id) {
    throw new Error(`${planItem.display_name} cannot be updated because no target id was resolved during dry-run.`);
  }

  if (typeof endpoint.updatePath === "function") {
    if (
      planItem.object_type === MigrationObjectType.CUSTOM_OBJECT_FIELDS ||
      planItem.object_type === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS ||
      planItem.object_type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS
    ) {
      return endpoint.updatePath(objectKey, planItem.target_id);
    }
    return endpoint.updatePath(planItem.target_id);
  }

  throw new Error(`${planItem.object_type} does not have an update endpoint.`);
}

function bodyFor(endpoint, payload) {
  return { [endpoint.wrapperKey]: payload };
}

function dropNotificationWebhookActions(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload.actions)) {
    payload.actions = payload.actions.filter((action) => String(action?.field || "") !== "notification_webhook");
  }
  return payload;
}

function normalizeViewConditionValues(payload) {
  const next = payload && typeof payload === "object" ? payload : {};
  for (const group of ["all", "any"]) {
    const conditions = next?.conditions?.[group];
    if (!Array.isArray(conditions)) continue;
    for (const condition of conditions) {
      if (condition && condition.value !== undefined && condition.value !== null) {
        condition.value = String(condition.value);
      }
    }
  }
  return next;
}

function dropField(payload, field, warnings, reason) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, field)) {
    delete payload[field];
    warnings.push(reason || `Removed ${field} because it is not safe to reuse across Zendesk instances.`);
  }
}

function prepareTicketPayloadForImport(payload, mapper, sourcePayload = {}, { preserveResolvedUserFields = false } = {}) {
  const warnings = [];
  const next = structuredClone(payload || {});

  if (!preserveResolvedUserFields) {
    for (const field of ["requester_id", "submitter_id", "assignee_id", "organization_id"]) {
      dropField(next, field, warnings);
    }
  }

  for (const field of [
    "brand_id",
    "custom_status_id",
    "collaborator_ids",
    "email_cc_ids",
    "follower_ids",
    "sharing_agreement_ids",
  ]) {
    dropField(next, field, warnings);
  }

  for (const field of ["group_id", "ticket_form_id"]) {
    const refType = field === "group_id" ? REF_TYPES.GROUP : REF_TYPES.TICKET_FORM;
    if (next[field] !== undefined && mapper.lookup(refType, sourcePayload[field]) === undefined) {
      dropField(next, field, warnings, `Removed ${field} because no target mapping was available.`);
    }
  }

  if (Array.isArray(next.custom_fields)) {
    const rewrittenFields = [];
    const sourceFields = Array.isArray(sourcePayload.custom_fields) ? sourcePayload.custom_fields : [];
    for (const [index, field] of next.custom_fields.entries()) {
      const sourceFieldId = sourceFields[index]?.id ?? field?.id;
      const mappedId = mapper.lookup(REF_TYPES.TICKET_FIELD, sourceFieldId);
      if (mappedId === undefined) {
        warnings.push(`Removed custom field ${sourceFieldId ?? "(unknown)"} because no target ticket field mapping was available.`);
        continue;
      }
      rewrittenFields.push({ ...field, id: mappedId });
    }
    if (rewrittenFields.length > 0) next.custom_fields = rewrittenFields;
    else delete next.custom_fields;
  }

  if (Array.isArray(next.comments)) {
    next.comments = next.comments.map((comment) => {
      const cleanComment = { ...comment };
      if (!preserveResolvedUserFields && cleanComment.author_id !== undefined) {
        delete cleanComment.author_id;
        warnings.push("Removed comment author_id because user IDs are not portable across Zendesk instances.");
      }
      return cleanComment;
    });
  }

  return { payload: next, warnings: [...new Set(warnings)] };
}

async function attemptReorder({ api, type, endpoint, ids, logs, apiErrors }) {
  if (!endpoint?.reorderPath || ids.length === 0) return;
  if (type === MigrationObjectType.TICKET_TRIGGERS) {
    logs.push("Skipped trigger reorder to avoid cross-category ordering conflicts; review trigger order manually.");
    return;
  }

  let preparedIds = ids.filter(Boolean);
  if (type === MigrationObjectType.AUTOMATIONS) {
    preparedIds = preparedIds.map((id) => Number(id)).filter((id) => Number.isInteger(id));
  }
  const uniqueIds = [...new Set(preparedIds)];
  if (uniqueIds.length === 0) return;
  if (type === MigrationObjectType.AUTOMATIONS && uniqueIds.length < 2) return;

  const key =
    type === MigrationObjectType.TICKET_TRIGGERS
      ? "trigger_ids"
      : type === MigrationObjectType.AUTOMATIONS
        ? "automation_ids"
        : "queue_ids";

  try {
    await api.request({
      path: endpoint.reorderPath,
      method: "PUT",
      body: { [key]: uniqueIds },
    });
    logs.push(`Preserved order for ${type} where supported.`);
  } catch (error) {
    const message = `${type} order could not be preserved automatically: ${error.message}`;
    logs.push(message);
    apiErrors.push({
      object_type: type,
      action: "REORDER",
      message,
      status: error?.status || null,
    });
  }
}

export async function executeImport({ api, bundle, plan, startupState, onProgress, webhookSetup = null, fullTicketSetup = null }) {
  if (!plan?.plan_id) {
    throw new Error("Run a dry-run before executing import.");
  }

  const startedAt = new Date().toISOString();
  const mapper = createReferenceMapper(bundle);
  const logs = [];
  const results = [];
  const apiErrors = [];
  const dependencyWarnings = [];
  const orderedItems = orderPlanItems(plan.items || []);
  const importedIdsByType = {};
  const importedTicketExternalIds = new Set();
  const webhookMapping = plan.options?.webhookMapping || {};
  const webhookDependencyPolicy = plan.options?.webhookDependencyPolicy || "manual_required";
  const targetSubdomain = startupState?.context?.subdomain || plan.target?.subdomain || "";
  const runtimeWebhookSetup = {
    targetEmail: String(webhookSetup?.targetEmail || "").trim(),
    apiToken: String(webhookSetup?.apiToken || ""),
    endpointOverrides: webhookSetup?.endpointOverrides || {},
  };
  let runtimeApiToken = runtimeWebhookSetup.apiToken;
  const fullTicketOptions = plan.options?.fullTicketMigration
    ? {
      fullTicketMigration: true,
      fullTicketAutoCreate: plan.options?.fullTicketAutoCreate !== false,
    }
    : {};
  const sourceTicketClient =
    fullTicketOptions.fullTicketMigration && fullTicketSetup?.sourceSubdomain && fullTicketSetup?.email && fullTicketSetup?.apiToken
      ? createSourceZendeskClient({
        sourceSubdomain: fullTicketSetup.sourceSubdomain,
        email: fullTicketSetup.email,
        apiToken: fullTicketSetup.apiToken,
      })
      : null;
  const fullTicketCache = { users: new Map(), organizations: new Map() };
  const webhookCredentialSupplied = Boolean(runtimeWebhookSetup.targetEmail && runtimeApiToken);
  const webhookWriteItems = orderedItems.filter((item) => item.object_type === MigrationObjectType.WEBHOOKS && isWriteAction(item.action));
  let processedWebhookWrites = 0;

  for (const [sourceKey, targetId] of Object.entries(webhookMapping)) {
    if (targetId !== undefined && targetId !== null && String(targetId).trim() !== "") {
      mapper.register(REF_TYPES.WEBHOOK, sourceKey, targetId);
    }
  }

  for (const item of orderedItems) {
    const existingTarget = item.target_id ? findTargetById(plan.target_state, item.object_type, item.target_id) : null;
    if (existingTarget) mapper.registerObjectResult(item.object_type, item.source_item, existingTarget);
  }

  for (const item of orderedItems) {
    onProgress?.({
      currentObjectType: item.object_type,
      currentItem: item.display_name,
      message: `${item.action}: ${item.display_name}`,
    });

    if (!isWriteAction(item.action)) {
      const status = responseStatus(item.action);
      const result = {
        object_type: item.object_type,
        display_name: item.display_name,
        status,
        reason: item.reason,
        warnings: item.warnings || [],
        classification: item.classification || null,
        compatibility_reasons: item.compatibility_reasons || [],
      };
      results.push(result);
      logs.push(`${actionPastTense(item.action)} ${item.object_type} "${item.display_name}": ${item.reason}`);
      continue;
    }

    if (item.object_type === MigrationObjectType.TICKETS) {
      const externalId = String(item.source_item?.payload?.external_id || "").trim().toLowerCase();
      if (externalId && importedTicketExternalIds.has(externalId)) {
        const reason = "Duplicate ticket in this import run skipped by external_id; ticket migration is create-only.";
        results.push({ object_type: item.object_type, display_name: item.display_name, status: "skipped", reason, warnings: item.warnings || [] });
        logs.push(reason);
        continue;
      }
    }

    const endpoint = getEndpoint(item.object_type);
    if (!endpoint) {
      const message = `${item.object_type} cannot be imported because no endpoint is configured.`;
      results.push({ object_type: item.object_type, display_name: item.display_name, status: "failed", reason: message });
      apiErrors.push({ object_type: item.object_type, action: item.action, message });
      logs.push(message);
      continue;
    }

    const rewrite = mapper.rewritePayload(item.source_item?.payload || {});
    if (item.auto_mutation_applied === "imported_inactive_due_to_unmapped_webhook") {
      rewrite.payload.active = false;
    }
    if (rewrite.missing.length > 0 && item.object_type === MigrationObjectType.TICKETS) {
      const warning = `Ticket references were not mapped and will be omitted where possible: ${rewrite.missing
        .map((ref) => `${ref.label} ${ref.value}`)
        .join(", ")}.`;
      item.warnings = [...(item.warnings || []), warning];
      rewrite.missing = [];
    }
    if (rewrite.missing.length > 0) {
      const webhookMissing = rewrite.missing.filter((ref) => ref.type === REF_TYPES.WEBHOOK);
      const isWebhookDependentRule =
        item.object_type === MigrationObjectType.TICKET_TRIGGERS ||
        item.object_type === MigrationObjectType.AUTOMATIONS ||
        item.object_type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS;
      if (isWebhookDependentRule && webhookMissing.length > 0) {
        if (webhookDependencyPolicy === "skip") {
          const reason = `Skipped because required webhook could not be created or mapped: ${webhookMissing.map((ref) => ref.value).join(", ")}.`;
          results.push({ object_type: item.object_type, display_name: item.display_name, status: "skipped", reason, warnings: item.warnings || [] });
          logs.push(reason);
          continue;
        }
        if (webhookDependencyPolicy === "inactive") {
          rewrite.payload.active = false;
          dropNotificationWebhookActions(rewrite.payload);
          rewrite.missing = rewrite.missing.filter((ref) => ref.type !== REF_TYPES.WEBHOOK);
          const warning = "Trigger/automation was not activated because required webhook could not be created.";
          item.warnings = [...(item.warnings || []), warning];
        } else {
          const reason = `Trigger/automation was not activated because required webhook could not be created: ${webhookMissing
            .map((ref) => ref.value)
            .join(", ")}.`;
          results.push({ object_type: item.object_type, display_name: item.display_name, status: "manual_required", reason, warnings: item.warnings || [] });
          logs.push(reason);
          continue;
        }
      }
    }
    if (rewrite.missing.length > 0) {
      const message = `${item.object_type} "${item.display_name}" was blocked because referenced dependencies were not created or found: ${rewrite.missing
        .map((ref) => `${ref.label} ${ref.value}`)
        .join(", ")}.`;
      results.push({ object_type: item.object_type, display_name: item.display_name, status: "failed", reason: message });
      dependencyWarnings.push({ object_type: item.object_type, display_name: item.display_name, missing: rewrite.missing });
      logs.push(message);
      continue;
    }

    try {
      if (item.object_type === MigrationObjectType.WEBHOOKS) {
        if (!runtimeWebhookSetup.targetEmail || !runtimeApiToken) {
          const reason = `Webhook "${item.display_name}" requires target Basic Auth details before it can be created.`;
          results.push({ object_type: item.object_type, display_name: item.display_name, status: "manual_required", reason, warnings: item.warnings || [] });
          logs.push(reason);
          processedWebhookWrites += 1;
          continue;
        }

        const sourceEndpoint = rewrite.payload?.endpoint || "";
        const override = runtimeWebhookSetup.endpointOverrides?.[item.source_key];
        const rewritten = rewriteZendeskWebhookEndpoint({ sourceEndpoint, targetSubdomain });
        rewrite.payload.endpoint = String(override || rewritten.endpoint || sourceEndpoint);
        rewrite.payload.authentication = buildWebhookAuthentication({
          email: runtimeWebhookSetup.targetEmail,
          apiToken: runtimeApiToken,
        });
        if (rewritten.warning) {
          item.warnings = [...(item.warnings || []), rewritten.warning];
        } else if (rewritten.rewritten && rewritten.sourceHost !== rewritten.targetHost) {
          item.warnings = [
            ...(item.warnings || []),
            `The source webhook endpoint was rewritten from ${rewritten.sourceHost} to ${rewritten.targetHost}.`,
          ];
        }
      }
      if (item.object_type === MigrationObjectType.TICKET_TRIGGERS && rewrite.payload?.category_id) {
        delete rewrite.payload.category_id;
        rewrite.payload.active = false;
      }
      if (item.object_type === MigrationObjectType.VIEWS) {
        normalizeViewConditionValues(rewrite.payload);
      }
      if (item.object_type === MigrationObjectType.TICKETS) {
        const fullPrepared = await prepareFullTicketPayload({
          api,
          item,
          payload: rewrite.payload,
          options: fullTicketOptions,
          sourceClient: sourceTicketClient,
          cache: fullTicketCache,
        });
        rewrite.payload = fullPrepared.payload;
        item.warnings = [...(item.warnings || []), ...fullPrepared.warnings];

        const prepared = prepareTicketPayloadForImport(rewrite.payload, mapper, item.source_item?.payload || {}, {
          preserveResolvedUserFields: fullTicketOptions.fullTicketMigration,
        });
        rewrite.payload = prepared.payload;
        item.warnings = [...(item.warnings || []), ...prepared.warnings];
      }
      if (item.auto_mutation_applied === "imported_inactive_due_to_unmapped_webhook") {
        rewrite.payload.active = false;
      }
      const path = createOrUpdatePath(endpoint, item.action, item);
      const { data } = await api.request({
        path,
        method: item.action === "CREATE" ? "POST" : "PUT",
        body: bodyFor(endpoint, rewrite.payload),
      });
      const targetItem = resultFromResponse(data, endpoint.wrapperKey);
      mapper.registerObjectResult(item.object_type, item.source_item, targetItem);

      const targetId = targetItem?.id || targetItem?.key || item.target_id || targetItem?.name;
      importedIdsByType[item.object_type] = importedIdsByType[item.object_type] || [];
      importedIdsByType[item.object_type].push(targetId);

      const status =
        item.object_type === MigrationObjectType.TICKETS && item.action === "CREATE" && (item.warnings || []).length > 0
          ? "created_with_warnings"
          : responseStatus(item.action);
      results.push({
        object_type: item.object_type,
        display_name: item.display_name,
        status,
        target_id: targetId || null,
        warnings: item.warnings || [],
      });
      logs.push(`${status} ${item.object_type} "${item.display_name}".`);
      if (item.object_type === MigrationObjectType.TICKETS) {
        const externalId = String(item.source_item?.payload?.external_id || "").trim().toLowerCase();
        if (externalId) importedTicketExternalIds.add(externalId);
      }
      if (item.object_type === MigrationObjectType.WEBHOOKS) {
        processedWebhookWrites += 1;
      }
    } catch (error) {
      const message = `${item.object_type} "${item.display_name}" could not be imported. ${error.message}`;
      results.push({
        object_type: item.object_type,
        display_name: item.display_name,
        status: "failed",
        reason: message,
        warnings: item.warnings || [],
      });
      apiErrors.push({
        object_type: item.object_type,
        display_name: item.display_name,
        action: item.action,
        message,
        status: error?.status || null,
      });
      logs.push(message);
      if (item.object_type === MigrationObjectType.WEBHOOKS) {
        processedWebhookWrites += 1;
      }

      if (plan.options?.continueOnError === false) {
        break;
      }
    }

    if (runtimeApiToken && webhookWriteItems.length > 0 && processedWebhookWrites >= webhookWriteItems.length) {
      runtimeApiToken = "";
      logs.push("The API token was not stored. It was cleared after webhook setup.");
    }
  }

  for (const type of [MigrationObjectType.TICKET_TRIGGERS, MigrationObjectType.AUTOMATIONS, MigrationObjectType.OMNICHANNEL_QUEUES]) {
    await attemptReorder({
      api,
      type,
      endpoint: getEndpoint(type),
      ids: importedIdsByType[type] || [],
      logs,
      apiErrors,
    });
  }

  const completedAt = new Date().toISOString();
  return buildExecutionReport({
    plan,
    bundle,
    target: {
      subdomain: startupState?.context?.subdomain || plan.target?.subdomain || "",
    },
    startedAt,
    completedAt,
    results,
    logs,
    apiErrors,
    dependencyWarnings,
    webhookCredentialSupplied,
  });
}
