import { APP_NAME, BUNDLE_VERSION, MIGRATION_OBJECT_ORDER } from "./objectTypes";

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function validateBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(bundle)) {
    return {
      valid: false,
      errors: ["The uploaded file must contain a JSON object."],
      warnings,
      summary: null,
    };
  }

  if (bundle.bundle_version !== BUNDLE_VERSION) {
    errors.push(`Unsupported migration bundle version "${bundle.bundle_version || "(missing)"}". Expected "${BUNDLE_VERSION}".`);
  }

  if (bundle.app_name && bundle.app_name !== APP_NAME) {
    warnings.push(`This bundle was created by "${bundle.app_name}", not "${APP_NAME}".`);
  }

  if (!isPlainObject(bundle.source)) {
    errors.push("Bundle is missing source metadata.");
  }

  if (!isPlainObject(bundle.scope)) {
    errors.push("Bundle is missing export scope.");
  }

  if (!isPlainObject(bundle.objects)) {
    errors.push("Bundle is missing objects.");
  } else {
    for (const type of MIGRATION_OBJECT_ORDER) {
      if (bundle.objects[type] === undefined) {
        warnings.push(`Bundle objects.${type} is missing and will be treated as empty.`);
      } else if (!Array.isArray(bundle.objects[type])) {
        errors.push(`Bundle objects.${type} must be an array.`);
      }
    }
  }

  const counts = MIGRATION_OBJECT_ORDER.reduce((summary, type) => {
    summary[type] = Array.isArray(bundle.objects?.[type]) ? bundle.objects[type].length : 0;
    return summary;
  }, {});

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      source: bundle.source || {},
      exported_at: bundle.exported_at || "",
      counts,
      warnings: bundle.metadata?.warnings || [],
      unsupported: bundle.metadata?.unsupported || [],
      skipped: bundle.metadata?.skipped || [],
    },
  };
}

export function assertValidBundle(bundle) {
  const validation = validateBundle(bundle);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }
  return validation;
}
