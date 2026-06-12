const TICKET_IMPORT_FIELDS = new Set([
  "assignee_id",
  "brand_id",
  "collaborator_ids",
  "created_at",
  "custom_fields",
  "custom_status_id",
  "description",
  "due_at",
  "email_cc_ids",
  "external_id",
  "follower_ids",
  "group_id",
  "organization_id",
  "priority",
  "recipient",
  "requester_id",
  "satisfaction_rating",
  "sharing_agreement_ids",
  "solved_at",
  "status",
  "subject",
  "submitter_id",
  "tags",
  "ticket_form_id",
  "type",
  "updated_at",
]);

const COMMENT_IMPORT_FIELDS = new Set([
  "author_id",
  "body",
  "created_at",
  "html_body",
  "public",
  "uploads",
  "value",
]);

function attachmentMetadata(attachment) {
  if (!attachment || typeof attachment !== "object") return null;
  return {
    id: attachment.id ?? null,
    file_name: attachment.file_name || attachment.filename || attachment.name || `attachment-${attachment.id || "file"}`,
    content_type: attachment.content_type || attachment.contentType || "application/octet-stream",
    size: attachment.size || null,
    content_url: attachment.content_url || attachment.mapped_content_url || attachment.url || "",
  };
}

function pickAllowed(source, allowedFields) {
  return Object.entries(source || {}).reduce((payload, [key, value]) => {
    if (allowedFields.has(key) && value !== undefined && value !== null) {
      payload[key] = value;
    }
    return payload;
  }, {});
}

function sourceExternalId(ticket, sourceSubdomain) {
  const id = ticket?.id;
  if (id === undefined || id === null || id === "") return ticket?.external_id || "";
  return `zendesk-migration:${sourceSubdomain || "unknown"}:ticket:${id}`;
}

export function normalizeTicketCommentForImport(comment) {
  const payload = pickAllowed(comment, COMMENT_IMPORT_FIELDS);
  if (!payload.value && !payload.body && !payload.html_body) {
    payload.value = comment?.plain_body || comment?.body || "";
  }
  return payload;
}

export function ticketCommentAttachmentMetadata(comment) {
  return (Array.isArray(comment?.attachments) ? comment.attachments : [])
    .map((attachment) => attachmentMetadata(attachment))
    .filter((attachment) => attachment && attachment.content_url);
}

export function normalizeTicketForImport(ticket, { comments = [], sourceSubdomain = "" } = {}) {
  const payload = pickAllowed(ticket, TICKET_IMPORT_FIELDS);
  payload.external_id = ticket?.external_id || sourceExternalId(ticket, sourceSubdomain);

  const normalizedComments = comments.map((comment) => normalizeTicketCommentForImport(comment)).filter((comment) => (
    Boolean(comment.value || comment.body || comment.html_body)
  ));

  if (normalizedComments.length > 0) {
    payload.comments = normalizedComments;
  } else if (!payload.description) {
    payload.description = ticket?.description || ticket?.subject || "Imported ticket";
  }

  if (!payload.subject) {
    payload.subject = ticket?.subject || `Imported ticket ${ticket?.id || ""}`.trim();
  }

  if (!Array.isArray(payload.tags)) {
    payload.tags = [];
  }
  if (!payload.tags.includes("zendesk_migrated")) {
    payload.tags = [...payload.tags, "zendesk_migrated"];
  }

  return payload;
}
