export const MigrationObjectType = Object.freeze({
  CUSTOM_OBJECTS: "custom_objects",
  CUSTOM_OBJECT_FIELDS: "custom_object_fields",
  CUSTOM_OBJECT_RELATIONSHIPS: "custom_object_relationships",
  GROUPS: "groups",
  TICKET_FIELDS: "ticket_fields",
  TICKET_FORMS: "ticket_forms",
  WEBHOOKS: "webhooks",
  MACROS: "macros",
  VIEWS: "views",
  TICKET_TRIGGERS: "ticket_triggers",
  AUTOMATIONS: "automations",
  CUSTOM_OBJECT_TRIGGERS: "custom_object_triggers",
  OMNICHANNEL_QUEUES: "omnichannel_queues",
  ROUTING_SETTINGS: "routing_settings",
});

export const MIGRATION_OBJECT_ORDER = Object.freeze([
  MigrationObjectType.CUSTOM_OBJECTS,
  MigrationObjectType.CUSTOM_OBJECT_FIELDS,
  MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS,
  MigrationObjectType.GROUPS,
  MigrationObjectType.TICKET_FIELDS,
  MigrationObjectType.TICKET_FORMS,
  MigrationObjectType.WEBHOOKS,
  MigrationObjectType.MACROS,
  MigrationObjectType.VIEWS,
  MigrationObjectType.TICKET_TRIGGERS,
  MigrationObjectType.AUTOMATIONS,
  MigrationObjectType.CUSTOM_OBJECT_TRIGGERS,
  MigrationObjectType.OMNICHANNEL_QUEUES,
  MigrationObjectType.ROUTING_SETTINGS,
]);

export const MIGRATION_OBJECT_LABELS = Object.freeze({
  [MigrationObjectType.CUSTOM_OBJECTS]: "Custom objects",
  [MigrationObjectType.CUSTOM_OBJECT_FIELDS]: "Custom object fields",
  [MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS]: "Custom object relationships",
  [MigrationObjectType.GROUPS]: "Groups",
  [MigrationObjectType.TICKET_FIELDS]: "Ticket fields",
  [MigrationObjectType.TICKET_FORMS]: "Ticket forms",
  [MigrationObjectType.WEBHOOKS]: "Webhooks",
  [MigrationObjectType.MACROS]: "Macros",
  [MigrationObjectType.VIEWS]: "Views",
  [MigrationObjectType.TICKET_TRIGGERS]: "Ticket triggers",
  [MigrationObjectType.AUTOMATIONS]: "Automations",
  [MigrationObjectType.CUSTOM_OBJECT_TRIGGERS]: "Custom object triggers",
  [MigrationObjectType.OMNICHANNEL_QUEUES]: "Omnichannel queues",
  [MigrationObjectType.ROUTING_SETTINGS]: "Routing settings",
});

export const DEFAULT_EXPORT_SCOPE = Object.freeze({
  [MigrationObjectType.GROUPS]: true,
  [MigrationObjectType.TICKET_FIELDS]: true,
  [MigrationObjectType.TICKET_FORMS]: true,
  [MigrationObjectType.MACROS]: true,
  [MigrationObjectType.VIEWS]: true,
  [MigrationObjectType.TICKET_TRIGGERS]: true,
  [MigrationObjectType.AUTOMATIONS]: true,
  [MigrationObjectType.WEBHOOKS]: true,
  [MigrationObjectType.CUSTOM_OBJECTS]: true,
  [MigrationObjectType.CUSTOM_OBJECT_FIELDS]: true,
  [MigrationObjectType.CUSTOM_OBJECT_RELATIONSHIPS]: true,
  [MigrationObjectType.CUSTOM_OBJECT_TRIGGERS]: true,
  [MigrationObjectType.OMNICHANNEL_QUEUES]: true,
  [MigrationObjectType.ROUTING_SETTINGS]: false,
});

export const EXCLUDED_OBJECT_TYPES = Object.freeze([
  "Tickets",
  "Help Center articles",
  "Help Center categories/sections",
  "Users",
  "Organizations",
  "Custom object records",
  "Inactive/deleted records",
  "Webhook secrets",
  "Runtime telemetry",
  "Audit logs",
  "Chat APIs blocked from Support app context",
]);

export const BUNDLE_VERSION = "1.0.0";
export const APP_NAME = "Instance Config Migrator";
