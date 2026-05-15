const SYSTEM_TICKET_FIELD_TYPES = new Set([
  "subject",
  "description",
  "status",
  "tickettype",
  "priority",
  "group",
  "assignee",
  "custom_status",
]);

export function isPortableTicketField(item) {
  const payload = item?.payload || {};
  const key = String(payload.key || item?.metadata?.source_key || "").trim().toLowerCase();
  const type = String(payload.type || "").trim().toLowerCase();

  if (key.startsWith("standard::")) return false;
  if (payload.agent_can_edit === false) return false;
  if (SYSTEM_TICKET_FIELD_TYPES.has(type)) return false;
  return true;
}

export function classifyPlanItemPortability(type, item) {
  if (type === "ticket_fields" && !isPortableTicketField(item)) {
    return {
      classification: "REFERENCE_ONLY",
      portable: false,
      reason: "Zendesk-managed ticket field is reference-only.",
    };
  }

  return {
    classification: "PORTABLE",
    portable: true,
    reason: "",
  };
}

