import { getEndpoint } from "./endpoints";
import { buildExecutionReport } from "./reportExporter";
import { orderPlanItems } from "./dependencyOrder";
import { MigrationObjectType } from "./objectTypes";
import { createReferenceMapper } from "./referenceMapper";

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
  if (action === "FAIL") return "failed";
  return "skipped";
}

function actionPastTense(action) {
  if (action === "CREATE") return "created";
  if (action === "UPDATE") return "updated";
  if (action === "SKIP") return "skipped";
  if (action === "MANUAL_REQUIRED") return "manual_required";
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

async function attemptReorder({ api, type, endpoint, ids, logs, apiErrors }) {
  if (!endpoint?.reorderPath || ids.length === 0) return;

  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return;

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

export async function executeImport({ api, bundle, plan, startupState, onProgress }) {
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
      };
      results.push(result);
      logs.push(`${actionPastTense(item.action)} ${item.object_type} "${item.display_name}": ${item.reason}`);
      continue;
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

      const status = responseStatus(item.action);
      results.push({
        object_type: item.object_type,
        display_name: item.display_name,
        status,
        target_id: targetId || null,
        warnings: item.warnings || [],
      });
      logs.push(`${status} ${item.object_type} "${item.display_name}".`);
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

      if (plan.options?.continueOnError === false) {
        break;
      }
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
  });
}
