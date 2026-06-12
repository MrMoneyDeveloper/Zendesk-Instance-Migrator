function basicAuthHeader(email, apiToken) {
  const raw = `${email}/token:${apiToken}`;
  if (typeof btoa === "function") return `Basic ${btoa(raw)}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function sourceBaseUrl(sourceSubdomain) {
  const value = String(sourceSubdomain || "").trim().replace(/^https?:\/\//i, "").replace(/\.zendesk\.com$/i, "");
  if (!value) throw new Error("Source Zendesk subdomain is required for full ticket migration.");
  return `https://${value}.zendesk.com`;
}

function sourcePathFromUrl(url) {
  const parsed = new URL(String(url || ""));
  return `${parsed.pathname}${parsed.search}`;
}

export function createSourceZendeskClient({ sourceSubdomain, email, apiToken, fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error("Fetch API is not available for source Zendesk requests.");
  const baseUrl = sourceBaseUrl(sourceSubdomain);
  const auth = basicAuthHeader(String(email || "").trim(), String(apiToken || ""));

  async function request(path, options = {}) {
    const url = String(path || "").startsWith("http") ? path : `${baseUrl}${path}`;
    const response = await fetchImpl(url, {
      ...options,
      headers: {
        Authorization: auth,
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Source Zendesk request failed with ${response.status} ${response.statusText}`.trim());
    }
    return response;
  }

  return {
    async downloadAttachment(attachment) {
      const response = await request(attachment.content_url);
      return {
        blob: await response.blob(),
        fileName: attachment.file_name || "attachment",
        contentType: attachment.content_type || response.headers.get("content-type") || "application/octet-stream",
      };
    },
    async readJson(pathOrUrl) {
      const response = await request(String(pathOrUrl || "").startsWith("http") ? sourcePathFromUrl(pathOrUrl) : pathOrUrl, {
        headers: { Accept: "application/json" },
      });
      return response.json();
    },
  };
}

function fullModeEnabled(options = {}) {
  return options.fullTicketMigration === true;
}

function userBySourceId(metadata, sourceId) {
  if (sourceId === undefined || sourceId === null) return null;
  return metadata?.users?.[String(sourceId)] || null;
}

function organizationBySourceId(metadata, sourceId) {
  if (sourceId === undefined || sourceId === null) return null;
  return metadata?.organizations?.[String(sourceId)] || null;
}

async function lookupTargetUserByEmail(api, email) {
  if (!email) return null;
  const { data } = await api.request({
    path: `/api/v2/users/search.json?query=${encodeURIComponent(email)}`,
    method: "GET",
  });
  const users = Array.isArray(data?.users) ? data.users : [];
  return users.find((user) => String(user.email || "").toLowerCase() === String(email).toLowerCase()) || null;
}

async function createTargetUser(api, user) {
  if (!user?.email) return null;
  const { data } = await api.request({
    path: "/api/v2/users/create_or_update.json",
    method: "POST",
    body: {
      user: {
        name: user.name || user.email,
        email: user.email,
        role: user.role === "agent" || user.role === "admin" ? "end-user" : user.role || "end-user",
        verified: true,
      },
    },
  });
  return data?.user || data;
}

async function resolveTargetUser(api, sourceUser, warnings, cache, autoCreate) {
  if (!sourceUser?.email) return null;
  const cacheKey = String(sourceUser.email).toLowerCase();
  if (cache.users.has(cacheKey)) return cache.users.get(cacheKey);

  let target = await lookupTargetUserByEmail(api, sourceUser.email);
  if (!target && autoCreate) {
    target = await createTargetUser(api, sourceUser);
    warnings.push(`Created missing user ${sourceUser.email} in target.`);
  }
  if (!target) warnings.push(`Could not map user ${sourceUser.email}; related ticket/user reference was omitted.`);
  cache.users.set(cacheKey, target || null);
  return target || null;
}

async function lookupTargetOrganizationByName(api, name) {
  if (!name) return null;
  const { data } = await api.request({
    path: `/api/v2/organizations/search.json?name=${encodeURIComponent(name)}`,
    method: "GET",
  });
  const organizations = Array.isArray(data?.organizations) ? data.organizations : [];
  return organizations.find((org) => String(org.name || "").toLowerCase() === String(name).toLowerCase()) || null;
}

async function createTargetOrganization(api, organization) {
  if (!organization?.name) return null;
  const { data } = await api.request({
    path: "/api/v2/organizations.json",
    method: "POST",
    body: {
      organization: {
        name: organization.name,
        external_id: organization.external_id || undefined,
      },
    },
  });
  return data?.organization || data;
}

async function resolveTargetOrganization(api, sourceOrganization, warnings, cache, autoCreate) {
  if (!sourceOrganization?.name) return null;
  const cacheKey = String(sourceOrganization.name).toLowerCase();
  if (cache.organizations.has(cacheKey)) return cache.organizations.get(cacheKey);

  let target = await lookupTargetOrganizationByName(api, sourceOrganization.name);
  if (!target && autoCreate) {
    target = await createTargetOrganization(api, sourceOrganization);
    warnings.push(`Created missing organization ${sourceOrganization.name} in target.`);
  }
  if (!target) warnings.push(`Could not map organization ${sourceOrganization.name}; organization_id was omitted.`);
  cache.organizations.set(cacheKey, target || null);
  return target || null;
}

function putIfResolved(payload, field, value) {
  if (value !== undefined && value !== null) payload[field] = value;
  else delete payload[field];
}

async function uploadAttachment(api, sourceClient, attachment) {
  if (typeof api.uploadFile !== "function") {
    throw new Error("Target attachment upload is not available in this Zendesk app runtime.");
  }
  const downloaded = await sourceClient.downloadAttachment(attachment);
  const upload = await api.uploadFile({
    fileName: downloaded.fileName,
    blob: downloaded.blob,
    contentType: downloaded.contentType,
  });
  return upload?.token || upload?.upload?.token || upload?.data?.upload?.token;
}

async function attachCommentUploads({ api, sourceClient, payload, metadata, warnings }) {
  const attachmentMap = metadata?.attachments_by_comment_index || {};
  if (!Array.isArray(payload.comments)) return;

  for (const [indexText, attachments] of Object.entries(attachmentMap)) {
    const index = Number(indexText);
    const comment = payload.comments[index];
    if (!comment || !Array.isArray(attachments) || attachments.length === 0) continue;

    const tokens = [];
    for (const attachment of attachments) {
      try {
        const token = await uploadAttachment(api, sourceClient, attachment);
        if (token) tokens.push(token);
      } catch (error) {
        warnings.push(`Attachment "${attachment.file_name || attachment.id || "file"}" was not migrated: ${error.message}`);
      }
    }
    if (tokens.length > 0) comment.uploads = [...(Array.isArray(comment.uploads) ? comment.uploads : []), ...tokens];
  }
}

export async function prepareFullTicketPayload({
  api,
  item,
  payload,
  options = {},
  sourceClient = null,
  cache = null,
}) {
  if (!fullModeEnabled(options)) {
    return { payload, warnings: [] };
  }

  const warnings = [];
  const next = structuredClone(payload || {});
  const metadata = item?.source_item?.metadata?.full_ticket_migration || {};
  const runtimeCache = cache || { users: new Map(), organizations: new Map() };
  const autoCreate = options.fullTicketAutoCreate !== false;

  for (const field of ["requester_id", "submitter_id", "assignee_id"]) {
    const sourceUser = userBySourceId(metadata, item?.source_item?.payload?.[field]);
    const targetUser = await resolveTargetUser(api, sourceUser, warnings, runtimeCache, autoCreate);
    putIfResolved(next, field, targetUser?.id);
  }

  if (Array.isArray(next.comments)) {
    for (const [index, comment] of next.comments.entries()) {
      const sourceAuthor = userBySourceId(metadata, item?.source_item?.payload?.comments?.[index]?.author_id);
      const targetAuthor = await resolveTargetUser(api, sourceAuthor, warnings, runtimeCache, autoCreate);
      if (targetAuthor?.id) comment.author_id = targetAuthor.id;
      else delete comment.author_id;
    }
  }

  const sourceOrganization = organizationBySourceId(metadata, item?.source_item?.payload?.organization_id);
  const targetOrganization = await resolveTargetOrganization(api, sourceOrganization, warnings, runtimeCache, autoCreate);
  putIfResolved(next, "organization_id", targetOrganization?.id);

  if (sourceClient) {
    await attachCommentUploads({ api, sourceClient, payload: next, metadata, warnings });
  } else if (Object.keys(metadata.attachments_by_comment_index || {}).length > 0) {
    warnings.push("Ticket attachments were not migrated because source Zendesk credentials were not supplied.");
  }

  return { payload: next, warnings: [...new Set(warnings)] };
}
