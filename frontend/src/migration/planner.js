import { assertValidBundle } from "./bundleValidator";
import { getEndpoint } from "./endpoints";
import { readTargetState } from "./importService";
import { displayNameFor, findMatch, stableKeyFor } from "./matchers";
import { MIGRATION_OBJECT_ORDER, MigrationObjectType } from "./objectTypes";
import { createReferenceMapper } from "./referenceMapper";
import { classifyPlanItemPortability } from "./portability";
import { validateBusinessRulePayload } from "./compatibility";

const SUMMARY_KEYS = ["create", "update", "skip", "fail", "manual_required", "reference_only"];

function planId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptySummary() {
  return SUMMARY_KEYS.reduce((summary, key) => {
    summary[key] = 0;
    return summary;
  }, {});
}

function increment(summary, action) {
  const key = String(action || "").toLowerCase();
  if (summary[key] !== undefined) summary[key] += 1;
}

function actionForUnsupported(type, unsupported) {
  if (
    type === MigrationObjectType.OMNICHANNEL_QUEUES ||
    type === MigrationObjectType.ROUTING_SETTINGS ||
    type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS
  ) {
    return {
      action: "MANUAL_REQUIRED",
      reason: unsupported?.message || `${type} is not available from this Zendesk app context.`,
    };
  }

  return {
    action: "FAIL",
    reason: unsupported?.message || `${type} could not be read from the current target instance.`,
  };
}

function endpointChangedWarning(type, item, targetItems) {
  if (type !== MigrationObjectType.WEBHOOKS) return null;
  const sourceName = item?.payload?.name;
  if (!sourceName) return null;

  const sameName = targetItems.find((target) => String(target.name || "").toLowerCase() === String(sourceName).toLowerCase());
  if (sameName && sameName.endpoint && sameName.endpoint !== item?.payload?.endpoint) {
    return `Webhook "${sourceName}" has a matching name in target but a different endpoint URL. It will be created as a separate webhook unless you update the target manually.`;
  }
  return null;
}

function optionsWithDefaults(options = {}) {
  return {
    overwriteExisting: options.overwriteExisting !== false,
    createOnly: options.createOnly === true,
    includeInactive: options.includeInactive === true,
    continueOnError: options.continueOnError !== false,
    webhookDependencyPolicy: options.webhookDependencyPolicy || "manual_required",
    webhookMapping: options.webhookMapping && typeof options.webhookMapping === "object" ? options.webhookMapping : {},
    webhookAuthConfigured: Boolean(options.webhookAuthConfigured),
    ticketImportDateRange: {
      from: String(options.ticketImportDateRange?.from || "").trim(),
      to: String(options.ticketImportDateRange?.to || "").trim(),
    },
  };
}

function startOfLocalDate(dateText) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfLocalDate(dateText) {
  if (!dateText) return null;
  const date = new Date(`${dateText}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ticketOutsideImportRange(item, ticketImportDateRange) {
  const from = startOfLocalDate(ticketImportDateRange?.from);
  const to = endOfLocalDate(ticketImportDateRange?.to);
  if (!from && !to) return false;

  const createdAt = new Date(item?.payload?.created_at || item?.metadata?.created_at || "");
  if (Number.isNaN(createdAt.getTime())) return false;
  if (from && createdAt < from) return true;
  if (to && createdAt > to) return true;
  return false;
}

function sourceWebhookKeys(bundle) {
  const keys = new Set();
  const webhooks = bundle?.objects?.[MigrationObjectType.WEBHOOKS] || [];
  for (const item of webhooks) {
    if (item?.metadata?.source_id !== undefined && item?.metadata?.source_id !== null) keys.add(String(item.metadata.source_id));
    if (item?.payload?.name) keys.add(String(item.payload.name));
  }
  return keys;
}

function webhookRefsForPayload(mapper, payload) {
  return mapper.collectReferences(payload).filter((ref) => ref.type === "webhook");
}

function unresolvedWebhookRefs(refs, knownSourceWebhookKeys, webhookMapping = {}) {
  return refs.filter((ref) => {
    const value = String(ref.value ?? "");
    if (!value) return false;
    if (knownSourceWebhookKeys.has(value)) return false;
    if (webhookMapping[value] !== undefined && webhookMapping[value] !== null && String(webhookMapping[value]).trim() !== "") return false;
    return true;
  });
}

export async function buildDryRunPlan({ api, bundle, startupState, options = {} }) {
  const validation = assertValidBundle(bundle);
  const importOptions = optionsWithDefaults(options);
  const scope = bundle.scope || {};
  const { state: targetState, unsupported } = await readTargetState({ api, bundle, scope });
  const unsupportedByType = new Map(unsupported.map((entry) => [entry.object_type, entry]));
  const mapper = createReferenceMapper(bundle);
  const knownSourceWebhookKeys = sourceWebhookKeys(bundle);
  const summary = emptySummary();
  const items = [];
  const blocked = [];
  const warnings = [...validation.warnings, ...(bundle.metadata?.warnings || [])];
  const plannedTicketExternalIds = new Set();

  for (const unsupportedEntry of unsupported) {
    warnings.push(unsupportedEntry.message);
  }

  for (const type of MIGRATION_OBJECT_ORDER) {
    const sourceItems = bundle.objects?.[type] || [];
    const targetItems = targetState[type] || [];
    const unsupportedEntry = unsupportedByType.get(type);

    for (const [index, item] of sourceItems.entries()) {
      const dependencies = mapper.collectReferences(item.payload || {});
      const missing = mapper.findMissingReferences(item.payload || {});
      const webhookRefs = webhookRefsForPayload(mapper, item.payload || {});
      const unresolvedWebhook = unresolvedWebhookRefs(webhookRefs, knownSourceWebhookKeys, importOptions.webhookMapping);
      const itemWarnings = [...(item.warnings || [])];
      const endpointWarning = endpointChangedWarning(type, item, targetItems);
      if (endpointWarning) itemWarnings.push(endpointWarning);

      const portability = classifyPlanItemPortability(type, item);
      const isTicket = type === MigrationObjectType.TICKETS;
      const ticketExternalId = String(item?.payload?.external_id || "").trim().toLowerCase();
      let match = null;
      let action = "CREATE";
      let reason = "No matching target item found.";

      if (isTicket && ticketOutsideImportRange(item, importOptions.ticketImportDateRange)) {
        action = "SKIP";
        reason = "Ticket skipped because its created_at is outside the selected ticket import range.";
      } else if (unsupportedEntry) {
        const unsupportedAction = actionForUnsupported(type, unsupportedEntry);
        action = unsupportedAction.action;
        reason = unsupportedAction.reason;
      } else if (!portability.portable) {
        match = findMatch(type, item, targetItems);
        if (match) mapper.registerObjectResult(type, item, match);
        action = "REFERENCE_ONLY";
        reason = portability.reason;
      } else if (!importOptions.includeInactive && item.active === false) {
        action = "SKIP";
        reason = "Inactive item excluded by import option.";
      } else if (isTicket && ticketExternalId && plannedTicketExternalIds.has(ticketExternalId)) {
        action = "SKIP";
        reason = "Duplicate ticket in this import bundle skipped by external_id; ticket migration is create-only.";
      } else if (type === MigrationObjectType.ROUTING_SETTINGS) {
        action = "SKIP";
        reason = getEndpoint(type)?.readOnlyImportReason || "readable_but_write_not_confirmed";
      } else if (item.metadata?.skipped_secret_required && type !== MigrationObjectType.WEBHOOKS) {
        action = "MANUAL_REQUIRED";
        reason = "Webhook requires manual secret reconfiguration after import.";
      } else if (unresolvedWebhook.length > 0 && (type === MigrationObjectType.TICKET_TRIGGERS || type === MigrationObjectType.AUTOMATIONS || type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS)) {
        if (importOptions.webhookDependencyPolicy === "skip") {
          action = "SKIP";
          reason = `Skipped because dependent webhook is not mapped: ${unresolvedWebhook.map((ref) => ref.value).join(", ")}.`;
        } else if (importOptions.webhookDependencyPolicy === "inactive") {
          reason = `Will import inactive because dependent webhook is not mapped: ${unresolvedWebhook.map((ref) => ref.value).join(", ")}.`;
        } else {
          action = "MANUAL_REQUIRED";
          reason = `Depends on webhook mapping not provided: ${unresolvedWebhook.map((ref) => ref.value).join(", ")}.`;
        }
      } else if (missing.length > 0 && isTicket) {
        itemWarnings.push(
          `Ticket has unmapped target-specific references that will be omitted during import: ${missing
            .map((ref) => `${ref.label} ${ref.value}`)
            .join(", ")}.`,
        );
      } else if (missing.length > 0) {
        action = "FAIL";
        reason = `Blocked because a referenced dependency is missing: ${missing.map((ref) => `${ref.label} ${ref.value}`).join(", ")}.`;
      } else {
        match = findMatch(type, item, targetItems);
        if (match) {
          mapper.registerObjectResult(type, item, match);
          if (type === MigrationObjectType.TICKETS) {
            action = "SKIP";
            reason = "Matching imported ticket exists by external_id; ticket migration is create-only.";
          } else if (importOptions.createOnly) {
            action = "SKIP";
            reason = "Matching target item exists and create-only mode is enabled.";
          } else if (importOptions.overwriteExisting) {
            action = "UPDATE";
            reason = "Matching target item found and overwrite existing is enabled.";
          } else {
            action = "SKIP";
            reason = "Matching target item exists and overwrite existing is disabled.";
          }
        }
      }
      const compatibility = validateBusinessRulePayload(type, item.payload || {});
      if ((action === "CREATE" || action === "UPDATE") && compatibility.status === "manual_required") {
        action = "MANUAL_REQUIRED";
        reason = compatibility.reasons.join(" ");
      }

      const planItem = {
        object_type: type,
        source_key: stableKeyFor(type, item),
        display_name: displayNameFor(type, item),
        action,
        reason,
        dependencies,
        warnings: itemWarnings,
        classification: portability.classification,
        compatibility_reasons: compatibility.reasons || [],
        order: item.metadata?.order ?? index,
        source_item: item,
        target_id: match?.id || match?.key || null,
        auto_mutation_applied:
          unresolvedWebhook.length > 0 && importOptions.webhookDependencyPolicy === "inactive"
            ? "imported_inactive_due_to_unmapped_webhook"
            : null,
        webhook_dependency:
          webhookRefs.length > 0
            ? {
              refs: webhookRefs.map((ref) => String(ref.value)),
              unresolved_refs: unresolvedWebhook.map((ref) => String(ref.value)),
              requires_webhook_auth: (bundle.objects?.[MigrationObjectType.WEBHOOKS] || []).length > 0,
              auth_configured: importOptions.webhookAuthConfigured,
              status:
                unresolvedWebhook.length > 0
                  ? importOptions.webhookDependencyPolicy === "inactive"
                    ? "IMPORT_INACTIVE_DUE_TO_WEBHOOK"
                    : "BLOCKED_WEBHOOK_CREATE_FAILED"
                  : importOptions.webhookAuthConfigured || (bundle.objects?.[MigrationObjectType.WEBHOOKS] || []).length === 0
                    ? "READY_AFTER_WEBHOOK"
                    : "BLOCKED_WEBHOOK_AUTH_REQUIRED",
            }
            : null,
      };

      if (type === MigrationObjectType.WEBHOOKS && (action === "CREATE" || action === "UPDATE")) {
        planItem.classification = action === "CREATE" ? "CREATE_WITH_BASIC_AUTH_REQUIRED" : "UPDATE_WITH_BASIC_AUTH_REQUIRED";
      }
      if (isTicket && action === "CREATE" && ticketExternalId) {
        plannedTicketExternalIds.add(ticketExternalId);
      }

      increment(summary, action);
      if (action === "FAIL") blocked.push(planItem);
      items.push(planItem);
    }
  }

  return {
    plan_id: planId(),
    created_at: new Date().toISOString(),
    target: {
      subdomain: startupState?.context?.subdomain || "",
    },
    options: importOptions,
    summary,
    items,
    warnings,
    blocked,
    unsupported,
    target_state: targetState,
    source_bundle: {
      bundle_version: bundle.bundle_version,
      exported_at: bundle.exported_at,
      source: bundle.source,
      metadata: bundle.metadata,
    },
  };
}
