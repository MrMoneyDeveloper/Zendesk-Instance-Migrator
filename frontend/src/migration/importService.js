import { getEndpoint } from "./endpoints";
import { MigrationObjectType, MIGRATION_OBJECT_ORDER } from "./objectTypes";

async function safeFetchAll(api, type, path, collectionKey) {
  try {
    return {
      ok: true,
      type,
      items: await api.fetchAll(path, collectionKey),
    };
  } catch (error) {
    return {
      ok: false,
      type,
      items: [],
      error: {
        object_type: type,
        reason: error?.code || "unsupported_from_client_app",
        message: error?.message || `${type} could not be read from the current target instance.`,
        path,
        status: error?.status || null,
      },
    };
  }
}

async function readCustomObjects(api) {
  const endpoint = getEndpoint(MigrationObjectType.CUSTOM_OBJECTS);
  return safeFetchAll(api, MigrationObjectType.CUSTOM_OBJECTS, endpoint.listPath, endpoint.collectionKey);
}

async function readCustomObjectChildren(api, type, objectKeys) {
  const endpoint = getEndpoint(type);
  const results = [];
  const unsupported = [];

  for (const objectKey of objectKeys) {
    const result = await safeFetchAll(api, type, endpoint.listPath(objectKey), endpoint.collectionKey);
    if (!result.ok) {
      unsupported.push(result.error);
      continue;
    }
    results.push(
      ...result.items.map((item) => ({
        ...item,
        object_key: item.object_key || objectKey,
        custom_object_key: item.custom_object_key || objectKey,
      })),
    );
  }

  return { ok: unsupported.length === 0, type, items: results, unsupported };
}

function bundleObjectKeys(bundle) {
  const fromObjects = (bundle.objects?.[MigrationObjectType.CUSTOM_OBJECTS] || [])
    .map((item) => item?.payload?.key)
    .filter(Boolean);

  const fromFields = [
    ...(bundle.objects?.[MigrationObjectType.CUSTOM_OBJECT_FIELDS] || []),
    ...(bundle.objects?.[MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS] || []),
    ...(bundle.objects?.[MigrationObjectType.CUSTOM_OBJECT_TRIGGERS] || []),
  ]
    .map((item) => item?.metadata?.object_key || item?.payload?.object_key)
    .filter(Boolean);

  return [...new Set([...fromObjects, ...fromFields])];
}

function isLookupRelationshipField(field) {
  const type = String(field?.type || field?.field_type || "").toLowerCase();
  return (
    type === "lookup" ||
    type === "lookup_relationship" ||
    Boolean(field?.relationship_target_type || field?.relationship_target_object || field?.lookup_relationship_target)
  );
}

export async function readTargetState({ api, bundle, scope }) {
  const state = {};
  const unsupported = [];
  const selectedTypes = MIGRATION_OBJECT_ORDER.filter((type) => scope?.[type] || bundle?.objects?.[type]?.length > 0);

  for (const type of selectedTypes) {
    if (type === MigrationObjectType.CUSTOM_OBJECT_FIELDS || type === MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS) {
      continue;
    }
    if (type === MigrationObjectType.CUSTOM_OBJECT_TRIGGERS) {
      continue;
    }
    if (type === MigrationObjectType.ROUTING_SETTINGS) {
      state[type] = [];
      unsupported.push({
        object_type: type,
        reason: "readable_but_write_not_confirmed",
        message: "Routing settings are readable, but writable fields are not confirmed. Import will skip them.",
      });
      continue;
    }

    const endpoint = getEndpoint(type);
    const result = await safeFetchAll(api, type, endpoint.listPath, endpoint.collectionKey);
    state[type] = result.items;
    if (!result.ok) unsupported.push(result.error);
  }

  const objectKeys = bundleObjectKeys(bundle);
  if (objectKeys.length > 0) {
    if (!state[MigrationObjectType.CUSTOM_OBJECTS]) {
      const customObjects = await readCustomObjects(api);
      state[MigrationObjectType.CUSTOM_OBJECTS] = customObjects.items;
      if (!customObjects.ok) unsupported.push(customObjects.error);
    }

    const childResults = await readCustomObjectChildren(api, MigrationObjectType.CUSTOM_OBJECT_FIELDS, objectKeys);
    state[MigrationObjectType.CUSTOM_OBJECT_FIELDS] = childResults.items.filter((item) => !isLookupRelationshipField(item));
    state[MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS] = childResults.items.filter((item) => isLookupRelationshipField(item));
    unsupported.push(...childResults.unsupported);

    const triggerResults = await readCustomObjectChildren(api, MigrationObjectType.CUSTOM_OBJECT_TRIGGERS, objectKeys);
    state[MigrationObjectType.CUSTOM_OBJECT_TRIGGERS] = triggerResults.items;
    unsupported.push(...triggerResults.unsupported);
  }

  return { state, unsupported };
}
