import { MigrationObjectType } from "./objectTypes";

const KNOWN_UNSUPPORTED_FIELDS = new Set([
  "collaboration_thread",
  "in_business_hours",
  "messaging_session_ended_reason",
  "generative_reply_deflection",
]);

export function validateBusinessRulePayload(type, payload) {
  if (![MigrationObjectType.VIEWS, MigrationObjectType.TICKET_TRIGGERS, MigrationObjectType.AUTOMATIONS].includes(type)) {
    return { status: "ok", reasons: [] };
  }

  const reasons = [];
  const text = JSON.stringify(payload || {}).toLowerCase();
  for (const unsupported of KNOWN_UNSUPPORTED_FIELDS) {
    if (text.includes(unsupported)) reasons.push(`Unsupported field/operator in target: ${unsupported}`);
  }
  if (text.includes('"brand_id"')) reasons.push("brand_id may require target-specific mapping.");
  if (text.includes('"recipient"')) reasons.push("recipient may require target support address mapping.");
  if (text.includes('"via_id"') || text.includes('"current_via_id"')) reasons.push("via/current_via values may be target-specific.");
  if (text.includes("until_sla_next_breach_at")) reasons.push("SLA business-hours operators may be unsupported.");

  if (reasons.length === 0) return { status: "ok", reasons };
  return { status: "manual_required", reasons };
}

