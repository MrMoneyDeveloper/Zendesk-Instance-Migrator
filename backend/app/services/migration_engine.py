from __future__ import annotations

import copy
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from app.models.schemas import MigrationOptions, MigrationPlanItem
from app.services.zendesk_client import ZendeskApiClient, ZendeskApiError

MIGRATION_OBJECT_ORDER = [
    "custom_objects",
    "custom_object_fields",
    "custom_object_relationships",
    "groups",
    "omnichannel_queues",
    "ticket_fields",
    "ticket_forms",
    "webhooks",
    "macros",
    "views",
    "triggers",
    "automations",
    "custom_object_triggers",
    "account_routing_settings",
    "chat_routing_settings",
]

BASIC_OBJECT_CONFIG = {
    "groups": {
        "list_path": "/api/v2/groups.json",
        "roots": ["groups"],
        "create_path": "/api/v2/groups.json",
        "update_path": "/api/v2/groups/{id}.json",
        "wrapper": "group",
        "response_roots": ["group"],
        "update_method": "PUT",
    },
    "ticket_fields": {
        "list_path": "/api/v2/ticket_fields.json",
        "roots": ["ticket_fields"],
        "create_path": "/api/v2/ticket_fields.json",
        "update_path": "/api/v2/ticket_fields/{id}.json",
        "wrapper": "ticket_field",
        "response_roots": ["ticket_field"],
        "update_method": "PUT",
    },
    "ticket_forms": {
        "list_path": "/api/v2/ticket_forms.json",
        "roots": ["ticket_forms"],
        "create_path": "/api/v2/ticket_forms.json",
        "update_path": "/api/v2/ticket_forms/{id}.json",
        "wrapper": "ticket_form",
        "response_roots": ["ticket_form"],
        "update_method": "PUT",
    },
    "webhooks": {
        "list_path": "/api/v2/webhooks",
        "roots": ["webhooks"],
        "create_path": "/api/v2/webhooks",
        "update_path": "/api/v2/webhooks/{id}",
        "wrapper": "webhook",
        "response_roots": ["webhook"],
        "update_method": "PATCH",
    },
    "macros": {
        "list_path": "/api/v2/macros.json",
        "roots": ["macros"],
        "create_path": "/api/v2/macros.json",
        "update_path": "/api/v2/macros/{id}.json",
        "wrapper": "macro",
        "response_roots": ["macro"],
        "update_method": "PUT",
    },
    "views": {
        "list_path": "/api/v2/views.json",
        "roots": ["views"],
        "create_path": "/api/v2/views.json",
        "update_path": "/api/v2/views/{id}.json",
        "wrapper": "view",
        "response_roots": ["view"],
        "update_method": "PUT",
    },
    "triggers": {
        "list_path": "/api/v2/triggers.json",
        "roots": ["triggers"],
        "create_path": "/api/v2/triggers.json",
        "update_path": "/api/v2/triggers/{id}.json",
        "wrapper": "trigger",
        "response_roots": ["trigger"],
        "update_method": "PUT",
    },
    "automations": {
        "list_path": "/api/v2/automations.json",
        "roots": ["automations"],
        "create_path": "/api/v2/automations.json",
        "update_path": "/api/v2/automations/{id}.json",
        "wrapper": "automation",
        "response_roots": ["automation"],
        "update_method": "PUT",
    },
}

RULE_REFERENCE_FIELDS = {
    "group_id": "groups",
    "ticket_form_id": "ticket_forms",
    "form_id": "ticket_forms",
    "ticket_field_id": "ticket_fields",
    "notification_webhook": "webhooks",
    "notification_webhook_id": "webhooks",
}

PAYLOAD_FIELDS = {
    "groups": ["name", "description", "default", "is_public"],
    "ticket_fields": [
        "title",
        "type",
        "description",
        "active",
        "required",
        "collapsed_for_agents",
        "regexp_for_validation",
        "title_in_portal",
        "visible_in_portal",
        "editable_in_portal",
        "required_in_portal",
        "tag",
        "custom_field_options",
        "relationship_target_type",
        "relationship_filter",
        "sub_type",
        "agent_can_edit",
    ],
    "ticket_forms": [
        "name",
        "display_name",
        "active",
        "in_all_brands",
        "in_all_groups",
        "end_user_visible",
        "ticket_field_ids",
        "restricted_brand_ids",
        "agent_conditions",
        "end_user_conditions",
    ],
    "webhooks": [
        "name",
        "description",
        "endpoint",
        "status",
        "http_method",
        "request_format",
        "subscriptions",
        "authentication",
        "custom_headers",
    ],
    "macros": ["title", "description", "actions", "active", "restriction"],
    "views": ["title", "description", "all", "any", "output", "active", "position", "restriction"],
    "triggers": ["title", "description", "conditions", "actions", "active", "position", "category_id"],
    "automations": ["title", "description", "conditions", "actions", "active", "position"],
    "custom_objects": ["key", "title", "title_pluralized", "description", "include_in_list_view"],
    "custom_object_fields": [
        "key",
        "title",
        "description",
        "type",
        "active",
        "required",
        "regexp_for_validation",
        "custom_field_options",
        "relationship_target_type",
        "relationship_filter",
        "properties",
    ],
    "custom_object_relationships": [
        "key",
        "title",
        "description",
        "type",
        "active",
        "required",
        "regexp_for_validation",
        "custom_field_options",
        "relationship_target_type",
        "relationship_filter",
        "properties",
    ],
    "custom_object_triggers": ["title", "description", "conditions", "actions", "active", "position"],
    "omnichannel_queues": ["name", "description", "priority", "definition", "subqueues"],
}

ACCOUNT_ROUTING_WRITABLE_FIELDS = {
    "enabled",
    "autorouting_tag",
    "max_email_capacity",
    "max_messaging_capacity",
    "reassignment_messaging_enabled",
    "reassignment_messaging_timeout",
    "reassignment_talk_timeout",
}

CHAT_ROUTING_WRITABLE_FIELDS = {
    "routing_mode",
    "chat_limit",
    "skill_routing",
    "reassignment",
    "auto_idle",
    "auto_accept",
}

CHAT_ROUTING_NESTED_WHITELISTS = {
    "chat_limit": {"enabled", "limit"},
    "skill_routing": {"enabled", "max_wait_time", "skills"},
    "reassignment": {"enabled", "timeout"},
    "auto_idle": {"enabled", "new_status", "reassignments_before_idle"},
    "auto_accept": {"enabled"},
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def ensure_array(value: Any) -> list:
    return value if isinstance(value, list) else []


def normalize_text(value: Any) -> str:
    return str(value or "").strip().lower()


def build_source_key(object_type: str, item: dict[str, Any], context: dict[str, Any] | None = None) -> str:
    context = context or {}
    if object_type == "custom_objects":
        return f"custom_object:{item.get('key') or item.get('id') or 'unknown'}"
    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        object_key = context.get("custom_object_key") or item.get("custom_object_key") or "unknown"
        return f"custom_object_field:{object_key}:{item.get('key') or item.get('id') or 'unknown'}"
    if object_type == "custom_object_triggers":
        object_key = context.get("custom_object_key") or item.get("custom_object_key") or "unknown"
        return f"custom_object_trigger:{object_key}:{item.get('title') or item.get('id') or 'unknown'}"
    if object_type == "groups":
        return f"group:{item.get('name') or item.get('id') or 'unknown'}"
    if object_type == "ticket_fields":
        return f"ticket_field:{item.get('key') or item.get('id') or item.get('title') or 'unknown'}"
    if object_type == "ticket_forms":
        return f"ticket_form:{item.get('name') or item.get('id') or 'unknown'}"
    if object_type == "webhooks":
        return f"webhook:{item.get('name') or 'unknown'}:{item.get('endpoint') or ''}"
    if object_type in {"macros", "views", "triggers", "automations"}:
        return f"{object_type[:-1] if object_type.endswith('s') else object_type}:{item.get('title') or item.get('id') or 'unknown'}"
    if object_type == "omnichannel_queues":
        return f"queue:{item.get('name') or item.get('id') or 'unknown'}"
    if object_type == "account_routing_settings":
        return "account_routing_settings"
    if object_type == "chat_routing_settings":
        return "chat_routing_settings"
    return f"{object_type}:{item.get('id') or item.get('key') or 'unknown'}"


def is_active_item(item: dict[str, Any]) -> bool:
    if "active" in item:
        return bool(item.get("active"))
    if "status" in item and isinstance(item.get("status"), str):
        return str(item.get("status")).strip().lower() == "active"
    return True


def _contains_masked_secret(value: Any) -> bool:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped and set(stripped) <= {"*", "•", "x", "X"}:
            return True
        if "*****" in stripped or "••••" in stripped:
            return True
    if isinstance(value, dict):
        return any(_contains_masked_secret(v) for v in value.values())
    if isinstance(value, list):
        return any(_contains_masked_secret(v) for v in value)
    return False


def is_secret_webhook_auth(authentication: Any) -> bool:
    if not isinstance(authentication, dict):
        return False
    auth_type = normalize_text(authentication.get("type"))
    data = authentication.get("data")
    if auth_type in {"api_key", "basic_auth", "bearer_token", "token"} and _contains_masked_secret(data):
        return True
    return False


def sort_by_position_then_title(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def _pos(item: dict[str, Any]) -> int:
        try:
            return int(item.get("position", 2**31 - 1))
        except (TypeError, ValueError):
            return 2**31 - 1

    return sorted(items, key=lambda item: (_pos(item), normalize_text(item.get("title") or item.get("name"))))


def _first_dict(payload: Any, roots: list[str]) -> dict[str, Any]:
    if isinstance(payload, dict):
        for root in roots:
            value = payload.get(root)
            if isinstance(value, dict):
                return value
        return payload
    return {}


def _filter_account_routing_settings(settings_payload: Any) -> dict[str, Any]:
    payload = _first_dict(settings_payload, ["settings"])
    routing = payload.get("routing") if isinstance(payload, dict) else None
    if not isinstance(routing, dict):
        return {}
    return {key: routing.get(key) for key in ACCOUNT_ROUTING_WRITABLE_FIELDS if key in routing}


def _filter_chat_routing_settings(payload: Any) -> dict[str, Any]:
    base = _first_dict(payload, ["data"])
    if not isinstance(base, dict):
        return {}

    filtered: dict[str, Any] = {}
    for key in CHAT_ROUTING_WRITABLE_FIELDS:
        if key not in base:
            continue
        value = base.get(key)
        nested_allowed = CHAT_ROUTING_NESTED_WHITELISTS.get(key)
        if nested_allowed and isinstance(value, dict):
            filtered[key] = {nested_key: value.get(nested_key) for nested_key in nested_allowed if nested_key in value}
        else:
            filtered[key] = value
    return filtered


async def load_state(client: ZendeskApiClient, *, include_omnichannel: bool = True, on_progress=None) -> dict[str, Any]:
    def notify(message: str) -> None:
        if callable(on_progress):
            on_progress({"at": _now_iso(), "message": message})

    state: dict[str, Any] = {
        "custom_objects": [],
        "custom_object_fields": {},
        "custom_object_relationships": {},
        "groups": [],
        "omnichannel_queues": [],
        "ticket_fields": [],
        "ticket_forms": [],
        "webhooks": [],
        "macros": [],
        "views": [],
        "triggers": [],
        "automations": [],
        "custom_object_triggers": {},
        "account_routing_settings": [],
        "chat_routing_settings": [],
        "__meta": {
            "omnichannel_queues_supported": True,
            "account_routing_supported": True,
            "chat_routing_supported": True,
            "warnings": [],
        },
    }

    notify("Loading custom objects...")
    state["custom_objects"] = await client.fetch_all_pages(
        "/api/v2/custom_objects",
        roots=["custom_objects"],
    )

    for custom_object in ensure_array(state["custom_objects"]):
        object_key = custom_object.get("key")
        if not object_key:
            continue

        notify(f"Loading custom object fields: {object_key}")
        fields = await client.fetch_all_pages(
            f"/api/v2/custom_objects/{object_key}/fields",
            roots=["custom_object_fields", "fields"],
        )
        object_fields = []
        object_relationships = []
        for field in fields:
            field_type = normalize_text(field.get("type"))
            if field_type == "lookup" or field.get("relationship_target_type"):
                object_relationships.append(field)
            else:
                object_fields.append(field)
        state["custom_object_fields"][object_key] = object_fields
        state["custom_object_relationships"][object_key] = object_relationships

        notify(f"Loading custom object triggers: {object_key}")
        triggers = await client.fetch_all_pages(
            f"/api/v2/custom_objects/{object_key}/triggers",
            roots=["triggers", "custom_object_triggers"],
        )
        scoped_triggers = []
        for trigger in triggers:
            scoped = dict(trigger)
            scoped["custom_object_key"] = object_key
            scoped_triggers.append(scoped)
        state["custom_object_triggers"][object_key] = scoped_triggers

    for object_type, config in BASIC_OBJECT_CONFIG.items():
        notify(f"Loading {object_type}...")
        state[object_type] = await client.fetch_all_pages(config["list_path"], roots=config["roots"])

    if include_omnichannel:
        notify("Loading omnichannel queues...")
        try:
            state["omnichannel_queues"] = await client.fetch_all_pages("/api/v2/queues", roots=["queues", "queue"])
        except ZendeskApiError as exc:
            state["__meta"]["omnichannel_queues_supported"] = False
            state["__meta"]["warnings"].append(
                f"Omnichannel queues unavailable ({exc.status_code or 'unknown'})."
            )

    notify("Loading account routing settings...")
    try:
        account_payload = (await client.request("GET", "/api/v2/account/settings")).data
        account_routing = _filter_account_routing_settings(account_payload)
        if account_routing:
            state["account_routing_settings"] = [account_routing]
    except ZendeskApiError as exc:
        state["__meta"]["account_routing_supported"] = False
        state["__meta"]["warnings"].append(
            f"Account routing settings unavailable ({exc.status_code or 'unknown'})."
        )

    notify("Loading chat routing settings...")
    try:
        chat_payload = (await client.request("GET", "/api/v2/chat/routing_settings/account")).data
        chat_routing = _filter_chat_routing_settings(chat_payload)
        if chat_routing:
            state["chat_routing_settings"] = [chat_routing]
    except ZendeskApiError as exc:
        state["__meta"]["chat_routing_supported"] = False
        state["__meta"]["warnings"].append(
            f"Chat routing settings unavailable ({exc.status_code or 'unknown'})."
        )

    return state


def _create_summary_row() -> dict[str, int]:
    return {"create": 0, "update": 0, "skip": 0}


def _get_type_entries(object_type: str, state: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    if object_type in {"custom_object_fields", "custom_object_relationships", "custom_object_triggers"}:
        scoped_map = state.get(object_type) if isinstance(state.get(object_type), dict) else {}
        entries: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for custom_object_key in sorted(scoped_map.keys()):
            scoped_items = ensure_array(scoped_map.get(custom_object_key))
            if object_type == "custom_object_triggers":
                scoped_items = sort_by_position_then_title(scoped_items)
            for item in scoped_items:
                entries.append((item, {"custom_object_key": custom_object_key}))
        return entries

    if object_type in {"triggers", "automations"}:
        return [(item, {}) for item in sort_by_position_then_title(ensure_array(state.get(object_type)))]

    return [(item, {}) for item in ensure_array(state.get(object_type))]


def _target_items_for_match(object_type: str, target_state: dict[str, Any], context: dict[str, Any]) -> list[dict[str, Any]]:
    if object_type in {"custom_object_fields", "custom_object_relationships", "custom_object_triggers"}:
        scoped = target_state.get(object_type)
        if isinstance(scoped, dict):
            return ensure_array(scoped.get(context.get("custom_object_key")))
        return []
    return ensure_array(target_state.get(object_type))


def _find_match(object_type: str, source: dict[str, Any], target_items: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any] | None:
    def by_predicate(predicate):
        for item in target_items:
            try:
                if predicate(item):
                    return item
            except Exception:
                continue
        return None

    if object_type == "custom_objects":
        source_key = normalize_text(source.get("key"))
        return by_predicate(lambda item: normalize_text(item.get("key")) == source_key) if source_key else None

    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        source_key = normalize_text(source.get("key"))
        return by_predicate(lambda item: normalize_text(item.get("key")) == source_key) if source_key else None

    if object_type == "groups":
        name = normalize_text(source.get("name") or source.get("title"))
        return by_predicate(lambda item: normalize_text(item.get("name") or item.get("title")) == name) if name else None

    if object_type == "ticket_fields":
        source_id = str(source.get("id") or "").strip()
        source_key = normalize_text(source.get("key"))
        source_title = normalize_text(source.get("title") or source.get("name"))
        if source_id:
            found = by_predicate(lambda item: str(item.get("id") or "").strip() == source_id)
            if found:
                return found
        if source_key:
            found = by_predicate(lambda item: normalize_text(item.get("key")) == source_key)
            if found:
                return found
        if source_title:
            return by_predicate(lambda item: normalize_text(item.get("title") or item.get("name")) == source_title)
        return None

    if object_type == "ticket_forms":
        source_name = normalize_text(source.get("name") or source.get("title"))
        return by_predicate(lambda item: normalize_text(item.get("name") or item.get("title")) == source_name) if source_name else None

    if object_type == "webhooks":
        source_name = normalize_text(source.get("name"))
        source_endpoint = normalize_text(source.get("endpoint"))
        if not source_name or not source_endpoint:
            return None
        return by_predicate(
            lambda item: normalize_text(item.get("name")) == source_name
            and normalize_text(item.get("endpoint")) == source_endpoint
        )

    if object_type in {"macros", "views", "triggers", "automations"}:
        source_title = normalize_text(source.get("title") or source.get("name"))
        return by_predicate(lambda item: normalize_text(item.get("title") or item.get("name")) == source_title) if source_title else None

    if object_type == "custom_object_triggers":
        source_title = normalize_text(source.get("title") or source.get("name"))
        source_key = normalize_text(context.get("custom_object_key") or source.get("custom_object_key"))
        if not source_title or not source_key:
            return None
        return by_predicate(
            lambda item: normalize_text(item.get("title") or item.get("name")) == source_title
            and normalize_text(item.get("custom_object_key") or context.get("custom_object_key")) == source_key
        )

    if object_type == "omnichannel_queues":
        source_id = str(source.get("id") or "").strip()
        source_name = normalize_text(source.get("name"))
        if source_id:
            found = by_predicate(lambda item: str(item.get("id") or "").strip() == source_id)
            if found:
                return found
        if source_name:
            return by_predicate(lambda item: normalize_text(item.get("name")) == source_name)
        return None

    if object_type in {"account_routing_settings", "chat_routing_settings"}:
        return target_items[0] if target_items else {}

    return None


def _get_dependency_refs(object_type: str, item: dict[str, Any], context: dict[str, Any]) -> list[str]:
    if object_type in {"custom_object_fields", "custom_object_relationships", "custom_object_triggers"}:
        return [f"custom_object:{context.get('custom_object_key') or item.get('custom_object_key') or 'unknown'}"]

    if object_type == "ticket_forms":
        return [f"ticket_field:{field_id}" for field_id in ensure_array(item.get("ticket_field_ids"))]

    if object_type == "omnichannel_queues":
        refs: list[str] = []
        for group in ensure_array((item.get("primary_groups") or {}).get("groups")):
            refs.append(f"group:{group.get('id')}")
        for group in ensure_array((item.get("secondary_groups") or {}).get("groups")):
            refs.append(f"group:{group.get('id')}")
        for subqueue in ensure_array((item.get("subqueues") or {}).get("subqueues")):
            for group in ensure_array((subqueue.get("primary_groups") or {}).get("groups")):
                refs.append(f"group:{group.get('id')}")
            for group in ensure_array((subqueue.get("secondary_groups") or {}).get("groups")):
                refs.append(f"group:{group.get('id')}")
        return refs

    if object_type in {"triggers", "automations", "macros", "views", "custom_object_triggers"}:
        refs: list[str] = []
        collections = []
        if isinstance(item.get("conditions"), dict):
            collections.append(item["conditions"].get("all"))
            collections.append(item["conditions"].get("any"))
        collections.append(item.get("all"))
        collections.append(item.get("any"))
        collections.append(item.get("actions"))

        for collection in collections:
            for entry in ensure_array(collection):
                field = normalize_text(entry.get("field"))
                if field == "group_id":
                    refs.append(f"group:{entry.get('value')}")
                if field in {"ticket_form_id", "form_id"}:
                    refs.append(f"ticket_form:{entry.get('value')}")
                if field == "ticket_field_id":
                    refs.append(f"ticket_field:{entry.get('value')}")
                if field in {"notification_webhook", "notification_webhook_id"}:
                    refs.append(f"webhook:{entry.get('value')}")
        return refs

    return []


def build_migration_plan(
    source_state: dict[str, Any],
    target_state: dict[str, Any],
    options: MigrationOptions,
) -> dict[str, Any]:
    summary_by_type: dict[str, dict[str, int]] = {}
    items: list[MigrationPlanItem] = []
    notes: list[str] = []

    for object_type in MIGRATION_OBJECT_ORDER:
        summary_by_type[object_type] = _create_summary_row()

        for source_item, context in _get_type_entries(object_type, source_state):
            if not isinstance(source_item, dict):
                continue

            if options.active_only and object_type not in {"account_routing_settings", "chat_routing_settings"} and not is_active_item(source_item):
                summary_by_type[object_type]["skip"] += 1
                items.append(
                    MigrationPlanItem(
                        object_type=object_type,
                        source_key=build_source_key(object_type, source_item, context),
                        action="skip",
                        dependency_refs=_get_dependency_refs(object_type, source_item, context),
                        reason="Skipped because item is inactive.",
                        source_item=source_item,
                        context=context,
                    )
                )
                continue

            if object_type == "webhooks" and is_secret_webhook_auth(source_item.get("authentication")):
                summary_by_type[object_type]["skip"] += 1
                items.append(
                    MigrationPlanItem(
                        object_type=object_type,
                        source_key=build_source_key(object_type, source_item, context),
                        action="skip",
                        dependency_refs=_get_dependency_refs(object_type, source_item, context),
                        reason="Skipped because webhook authentication contains non-resolvable secret values.",
                        source_item=source_item,
                        context=context,
                    )
                )
                continue

            target_items = _target_items_for_match(object_type, target_state, context)
            match = _find_match(object_type, source_item, target_items, context)

            if object_type in {"account_routing_settings", "chat_routing_settings"} and not source_item:
                summary_by_type[object_type]["skip"] += 1
                items.append(
                    MigrationPlanItem(
                        object_type=object_type,
                        source_key=build_source_key(object_type, source_item, context),
                        action="skip",
                        dependency_refs=[],
                        reason="No source settings were returned.",
                        source_item=source_item,
                        context=context,
                    )
                )
                continue

            action: str
            if match:
                action = "update" if options.overwrite_existing else "skip"
            else:
                action = "create"

            summary_by_type[object_type][action] += 1
            reason = (
                "Matched existing object and will overwrite."
                if action == "update"
                else "No existing match found; will create."
                if action == "create"
                else "Matched existing object and overwrite disabled."
            )

            items.append(
                MigrationPlanItem(
                    object_type=object_type,
                    source_key=build_source_key(object_type, source_item, context),
                    action=action,
                    dependency_refs=_get_dependency_refs(object_type, source_item, context),
                    reason=reason,
                    source_item=source_item,
                    context=context,
                    match=match,
                )
            )

    source_meta = source_state.get("__meta") if isinstance(source_state.get("__meta"), dict) else {}
    for warning in ensure_array(source_meta.get("warnings")):
        notes.append(str(warning))

    notes.append("Dry-run excludes inactive items and does not include tickets, help center/articles, or custom object records.")
    notes.append("Webhook entries with masked secrets are skipped.")
    notes.append("Trigger, automation, custom object trigger, and queue ordering are normalized after migration.")

    totals = {"create": 0, "update": 0, "skip": 0}
    for row in summary_by_type.values():
        totals["create"] += row["create"]
        totals["update"] += row["update"]
        totals["skip"] += row["skip"]

    return {
        "generated_at": _now_iso(),
        "execution_order": MIGRATION_OBJECT_ORDER,
        "summary_by_type": summary_by_type,
        "totals": totals,
        "notes": notes,
        "items": [item.model_dump() for item in items],
    }


def _pick(source: dict[str, Any], allowed: list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for field in allowed:
        if field in source:
            payload[field] = copy.deepcopy(source[field])
    return payload


def _rewrite_rule_entries(entries: list[dict[str, Any]], id_maps: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rewritten: list[dict[str, Any]] = []
    for entry in ensure_array(entries):
        if not isinstance(entry, dict):
            rewritten.append(entry)
            continue
        field = normalize_text(entry.get("field"))
        map_key = RULE_REFERENCE_FIELDS.get(field)
        if not map_key:
            rewritten.append(entry)
            continue
        value = entry.get("value")
        mapped = _resolve_mapped_id(id_maps, map_key, value)
        next_entry = dict(entry)
        next_entry["value"] = mapped
        rewritten.append(next_entry)
    return rewritten


def _resolve_mapped_id(id_maps: dict[str, dict[str, Any]], map_key: str, raw_value: Any) -> Any:
    if raw_value is None:
        return raw_value
    mapping = id_maps.get(map_key) or {}
    raw_key = str(raw_value).strip()
    if raw_key in mapping:
        return mapping[raw_key]
    normalized_key = normalize_text(raw_value)
    if normalized_key in mapping:
        return mapping[normalized_key]
    return raw_value


def _rewrite_references(object_type: str, payload: dict[str, Any], id_maps: dict[str, dict[str, Any]]) -> dict[str, Any]:
    mutated = copy.deepcopy(payload)

    if object_type == "ticket_forms":
        mutated["ticket_field_ids"] = [
            _resolve_mapped_id(id_maps, "ticket_fields", field_id)
            for field_id in ensure_array(mutated.get("ticket_field_ids"))
        ]
        return mutated

    if object_type in {"triggers", "automations", "custom_object_triggers"}:
        conditions = mutated.get("conditions") if isinstance(mutated.get("conditions"), dict) else {}
        mutated["conditions"] = {
            "all": _rewrite_rule_entries(ensure_array(conditions.get("all")), id_maps),
            "any": _rewrite_rule_entries(ensure_array(conditions.get("any")), id_maps),
        }
        mutated["actions"] = _rewrite_rule_entries(ensure_array(mutated.get("actions")), id_maps)
        return mutated

    if object_type == "views":
        mutated["all"] = _rewrite_rule_entries(ensure_array(mutated.get("all")), id_maps)
        mutated["any"] = _rewrite_rule_entries(ensure_array(mutated.get("any")), id_maps)
        return mutated

    if object_type == "macros":
        mutated["actions"] = _rewrite_rule_entries(ensure_array(mutated.get("actions")), id_maps)
        return mutated

    if object_type == "omnichannel_queues":
        primary_ids = []
        secondary_ids = []
        for group in ensure_array((mutated.get("primary_groups") or {}).get("groups")):
            primary_ids.append(_resolve_mapped_id(id_maps, "groups", group.get("id")))
        for group in ensure_array((mutated.get("secondary_groups") or {}).get("groups")):
            secondary_ids.append(_resolve_mapped_id(id_maps, "groups", group.get("id")))

        if primary_ids:
            mutated["primary_groups_id"] = [group_id for group_id in primary_ids if group_id]
        if secondary_ids:
            mutated["secondary_groups_id"] = [group_id for group_id in secondary_ids if group_id]

        if isinstance(mutated.get("subqueues"), dict):
            remapped_subqueues = []
            for subqueue in ensure_array(mutated["subqueues"].get("subqueues")):
                next_subqueue = dict(subqueue)
                sub_primary_ids = [
                    _resolve_mapped_id(id_maps, "groups", group.get("id"))
                    for group in ensure_array((subqueue.get("primary_groups") or {}).get("groups"))
                ]
                sub_secondary_ids = [
                    _resolve_mapped_id(id_maps, "groups", group.get("id"))
                    for group in ensure_array((subqueue.get("secondary_groups") or {}).get("groups"))
                ]
                next_subqueue["primary_groups_id"] = [gid for gid in sub_primary_ids if gid]
                next_subqueue["secondary_groups_id"] = [gid for gid in sub_secondary_ids if gid]
                next_subqueue.pop("primary_groups", None)
                next_subqueue.pop("secondary_groups", None)
                next_subqueue.pop("id", None)
                remapped_subqueues.append(next_subqueue)
            mutated["subqueues"] = {"subqueues": remapped_subqueues}

        mutated.pop("primary_groups", None)
        mutated.pop("secondary_groups", None)
        mutated.pop("id", None)
        mutated.pop("url", None)
        mutated.pop("created_at", None)
        mutated.pop("updated_at", None)
        return mutated

    return mutated


def _prepare_payload(object_type: str, source_item: dict[str, Any], context: dict[str, Any], action: str) -> dict[str, Any]:
    allowed = PAYLOAD_FIELDS.get(object_type)
    payload = _pick(source_item, allowed) if allowed else copy.deepcopy(source_item)

    if object_type == "custom_objects" and action == "update":
        payload.pop("key", None)

    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        payload["custom_object_key"] = context.get("custom_object_key")
        if action == "update":
            payload.pop("key", None)

    if object_type == "custom_object_triggers":
        payload["custom_object_key"] = context.get("custom_object_key")

    if object_type == "account_routing_settings":
        payload = {key: source_item.get(key) for key in ACCOUNT_ROUTING_WRITABLE_FIELDS if key in source_item}

    if object_type == "chat_routing_settings":
        payload = _filter_chat_routing_settings({"data": source_item})

    return payload


def _read_response_item(payload: Any, roots: list[str]) -> dict[str, Any]:
    if isinstance(payload, dict):
        for root in roots:
            value = payload.get(root)
            if isinstance(value, dict):
                return value
        return payload
    return {}


async def _create_object(
    client: ZendeskApiClient,
    object_type: str,
    payload: dict[str, Any],
    context: dict[str, Any],
) -> dict[str, Any]:
    if object_type in BASIC_OBJECT_CONFIG:
        config = BASIC_OBJECT_CONFIG[object_type]
        response = await client.request(
            "POST",
            config["create_path"],
            json_body={config["wrapper"]: payload},
        )
        return _read_response_item(response.data, config["response_roots"])

    if object_type == "custom_objects":
        response = await client.request("POST", "/api/v2/custom_objects", json_body={"custom_object": payload})
        return _read_response_item(response.data, ["custom_object"])

    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        object_key = context.get("custom_object_key") or payload.get("custom_object_key")
        response = await client.request(
            "POST",
            f"/api/v2/custom_objects/{object_key}/fields",
            json_body={"custom_object_field": {k: v for k, v in payload.items() if k != "custom_object_key"}},
        )
        return _read_response_item(response.data, ["custom_object_field"])

    if object_type == "custom_object_triggers":
        object_key = context.get("custom_object_key") or payload.get("custom_object_key")
        response = await client.request(
            "POST",
            f"/api/v2/custom_objects/{object_key}/triggers",
            json_body={"trigger": {k: v for k, v in payload.items() if k != "custom_object_key"}},
        )
        return _read_response_item(response.data, ["trigger"])

    if object_type == "omnichannel_queues":
        response = await client.request("POST", "/api/v2/queues", json_body={"queue": payload})
        return _read_response_item(response.data, ["queue"])

    if object_type == "account_routing_settings":
        response = await client.request("PUT", "/api/v2/account/settings", json_body={"settings": {"routing": payload}})
        updated = _filter_account_routing_settings(response.data)
        return updated

    if object_type == "chat_routing_settings":
        response = await client.request("PATCH", "/api/v2/chat/routing_settings/account", json_body=payload)
        updated = _filter_chat_routing_settings(response.data)
        return updated

    raise ZendeskApiError(f"Unsupported object type for create: {object_type}")


async def _update_object(
    client: ZendeskApiClient,
    object_type: str,
    payload: dict[str, Any],
    context: dict[str, Any],
    match: dict[str, Any] | None,
    source_item: dict[str, Any],
) -> dict[str, Any]:
    match = match or {}

    if object_type in BASIC_OBJECT_CONFIG:
        config = BASIC_OBJECT_CONFIG[object_type]
        target_id = match.get("id")
        if target_id is None:
            raise ZendeskApiError(f"Cannot update {object_type}; target id missing.")
        response = await client.request(
            config["update_method"],
            config["update_path"].format(id=target_id),
            json_body={config["wrapper"]: payload},
        )
        return _read_response_item(response.data, config["response_roots"])

    if object_type == "custom_objects":
        object_key = match.get("key") or source_item.get("key")
        response = await client.request(
            "PATCH",
            f"/api/v2/custom_objects/{object_key}",
            json_body={"custom_object": payload},
        )
        return _read_response_item(response.data, ["custom_object"])

    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        object_key = context.get("custom_object_key") or source_item.get("custom_object_key")
        field_key_or_id = match.get("key") or match.get("id") or source_item.get("key") or source_item.get("id")
        response = await client.request(
            "PATCH",
            f"/api/v2/custom_objects/{object_key}/fields/{field_key_or_id}",
            json_body={"custom_object_field": {k: v for k, v in payload.items() if k != "custom_object_key"}},
        )
        return _read_response_item(response.data, ["custom_object_field"])

    if object_type == "custom_object_triggers":
        object_key = context.get("custom_object_key") or source_item.get("custom_object_key")
        trigger_id = match.get("id")
        if trigger_id is None:
            raise ZendeskApiError("Cannot update custom object trigger; target id missing.")
        response = await client.request(
            "PUT",
            f"/api/v2/custom_objects/{object_key}/triggers/{trigger_id}",
            json_body={"trigger": {k: v for k, v in payload.items() if k != "custom_object_key"}},
        )
        return _read_response_item(response.data, ["trigger"])

    if object_type == "omnichannel_queues":
        queue_id = match.get("id")
        if not queue_id:
            raise ZendeskApiError("Cannot update queue; target id missing.")
        response = await client.request("PUT", f"/api/v2/queues/{queue_id}", json_body={"queue": payload})
        return _read_response_item(response.data, ["queue"])

    if object_type == "account_routing_settings":
        response = await client.request("PUT", "/api/v2/account/settings", json_body={"settings": {"routing": payload}})
        return _filter_account_routing_settings(response.data)

    if object_type == "chat_routing_settings":
        response = await client.request("PATCH", "/api/v2/chat/routing_settings/account", json_body=payload)
        return _filter_chat_routing_settings(response.data)

    raise ZendeskApiError(f"Unsupported object type for update: {object_type}")


def _add_mappings(id_maps: dict[str, dict[str, Any]], object_type: str, source_item: dict[str, Any], target_item: dict[str, Any], context: dict[str, Any]) -> None:
    target_id = target_item.get("id")
    source_id = source_item.get("id")

    if target_id is not None and source_id is not None:
        id_maps.setdefault(object_type, {})[str(source_id)] = target_id

    if object_type == "groups":
        source_name = normalize_text(source_item.get("name") or source_item.get("title"))
        if source_name and target_id is not None:
            id_maps.setdefault("groups", {})[source_name] = target_id

    if object_type == "ticket_fields":
        if source_item.get("key"):
            id_maps.setdefault("ticket_fields", {})[normalize_text(source_item["key"])] = target_id
        if source_item.get("title"):
            id_maps.setdefault("ticket_fields", {})[normalize_text(source_item["title"])] = target_id

    if object_type == "ticket_forms":
        source_name = normalize_text(source_item.get("name") or source_item.get("title"))
        if source_name and target_id is not None:
            id_maps.setdefault("ticket_forms", {})[source_name] = target_id

    if object_type == "webhooks":
        map_key = f"{normalize_text(source_item.get('name'))}|{normalize_text(source_item.get('endpoint'))}"
        if map_key and target_id is not None:
            id_maps.setdefault("webhooks", {})[map_key] = target_id

    if object_type == "custom_objects":
        source_key = normalize_text(source_item.get("key"))
        if source_key:
            id_maps.setdefault("custom_objects", {})[source_key] = target_item.get("key") or source_item.get("key")

    if object_type in {"custom_object_fields", "custom_object_relationships"}:
        object_key = normalize_text(context.get("custom_object_key") or source_item.get("custom_object_key"))
        source_key = normalize_text(source_item.get("key") or source_item.get("id"))
        target_field_key_or_id = target_item.get("key") or target_item.get("id")
        if object_key and source_key and target_field_key_or_id is not None:
            composite = f"{object_key}:{source_key}"
            id_maps.setdefault("custom_object_fields", {})[composite] = target_field_key_or_id
            id_maps.setdefault("custom_object_relationships", {})[composite] = target_field_key_or_id

    if object_type == "custom_object_triggers":
        object_key = normalize_text(context.get("custom_object_key") or source_item.get("custom_object_key"))
        source_title = normalize_text(source_item.get("title") or source_item.get("name"))
        if object_key and source_title and target_id is not None:
            id_maps.setdefault("custom_object_triggers", {})[f"{object_key}:{source_title}"] = target_id

    if object_type == "omnichannel_queues":
        source_name = normalize_text(source_item.get("name"))
        if source_name and target_id is not None:
            id_maps.setdefault("omnichannel_queues", {})[source_name] = target_id


async def _reorder_objects(
    client: ZendeskApiClient,
    reorder_buckets: dict[str, list[dict[str, Any]]],
) -> None:
    if reorder_buckets["triggers"]:
        ordered = [
            {"id": entry["id"], "position": index + 1}
            for index, entry in enumerate(sorted(reorder_buckets["triggers"], key=lambda item: item["position"]))
        ]
        await client.request("PUT", "/api/v2/triggers/update_many", json_body={"triggers": ordered})

    if reorder_buckets["automations"]:
        ordered = [
            {"id": entry["id"], "position": index + 1}
            for index, entry in enumerate(sorted(reorder_buckets["automations"], key=lambda item: item["position"]))
        ]
        await client.request("PUT", "/api/v2/automations/update_many", json_body={"automations": ordered})

    if reorder_buckets["custom_object_triggers"]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for entry in reorder_buckets["custom_object_triggers"]:
            grouped[entry["custom_object_key"]].append(entry)

        for custom_object_key, entries in grouped.items():
            ordered = [
                {"id": entry["id"], "position": index + 1}
                for index, entry in enumerate(sorted(entries, key=lambda item: item["position"]))
            ]
            await client.request(
                "PUT",
                f"/api/v2/custom_objects/{custom_object_key}/triggers/update_many",
                json_body={"triggers": ordered},
            )

    if reorder_buckets["omnichannel_queues"]:
        ordered_queue_ids = [
            entry["id"]
            for entry in sorted(reorder_buckets["omnichannel_queues"], key=lambda item: item["position"])
            if entry.get("id")
        ]
        if ordered_queue_ids:
            await client.request("PATCH", "/api/v2/queues/order", json_body={"queue_ids": ordered_queue_ids})


async def execute_migration_plan(
    client: ZendeskApiClient,
    plan: dict[str, Any],
    *,
    on_progress=None,
) -> dict[str, Any]:
    items = ensure_array(plan.get("items"))
    if not items:
        raise ZendeskApiError("Migration plan is empty.")

    id_maps: dict[str, dict[str, Any]] = {
        "groups": {},
        "ticket_fields": {},
        "ticket_forms": {},
        "webhooks": {},
        "custom_objects": {},
        "custom_object_fields": {},
        "custom_object_relationships": {},
        "triggers": {},
        "automations": {},
        "macros": {},
        "views": {},
        "custom_object_triggers": {},
        "omnichannel_queues": {},
    }

    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    created = 0
    updated = 0
    skipped = 0
    failed = 0

    reorder_buckets: dict[str, list[dict[str, Any]]] = {
        "triggers": [],
        "automations": [],
        "custom_object_triggers": [],
        "omnichannel_queues": [],
    }

    def notify(event: dict[str, Any]) -> None:
        if callable(on_progress):
            payload = dict(event)
            payload["at"] = _now_iso()
            on_progress(payload)

    for index, raw_item in enumerate(items):
        item = raw_item if isinstance(raw_item, dict) else {}
        object_type = str(item.get("object_type") or "").strip()
        source_item = item.get("source_item") if isinstance(item.get("source_item"), dict) else {}
        context = item.get("context") if isinstance(item.get("context"), dict) else {}
        action = str(item.get("action") or "skip")

        notify(
            {
                "type": "item_start",
                "index": index,
                "total": len(items),
                "object_type": object_type,
                "source_key": item.get("source_key"),
                "action": action,
            }
        )

        if action == "skip":
            skipped += 1
            result = {
                "object_type": object_type,
                "source_key": item.get("source_key"),
                "status": "skipped",
                "reason": item.get("reason"),
            }
            records.append(result)
            notify({"type": "item_complete", **result})
            continue

        try:
            payload = _prepare_payload(object_type, source_item, context, action)
            payload = _rewrite_references(object_type, payload, id_maps)

            if action == "update":
                target_item = await _update_object(
                    client,
                    object_type,
                    payload,
                    context,
                    item.get("match") if isinstance(item.get("match"), dict) else None,
                    source_item,
                )
                updated += 1
                status = "updated"
            else:
                target_item = await _create_object(client, object_type, payload, context)
                created += 1
                status = "created"

            _add_mappings(id_maps, object_type, source_item, target_item, context)

            if object_type in {"triggers", "automations"} and target_item.get("id") is not None:
                try:
                    position = int(source_item.get("position"))
                except (TypeError, ValueError):
                    position = len(reorder_buckets[object_type]) + 1
                reorder_buckets[object_type].append({"id": target_item.get("id"), "position": position})

            if object_type == "custom_object_triggers" and target_item.get("id") is not None:
                try:
                    position = int(source_item.get("position"))
                except (TypeError, ValueError):
                    position = len(reorder_buckets["custom_object_triggers"]) + 1
                reorder_buckets["custom_object_triggers"].append(
                    {
                        "id": target_item.get("id"),
                        "position": position,
                        "custom_object_key": context.get("custom_object_key") or source_item.get("custom_object_key"),
                    }
                )

            if object_type == "omnichannel_queues" and target_item.get("id") is not None:
                try:
                    position = int(source_item.get("order"))
                except (TypeError, ValueError):
                    position = len(reorder_buckets["omnichannel_queues"]) + 1
                reorder_buckets["omnichannel_queues"].append(
                    {
                        "id": target_item.get("id"),
                        "position": position,
                    }
                )

            result = {
                "object_type": object_type,
                "source_key": item.get("source_key"),
                "status": status,
                "target_id": target_item.get("id"),
            }
            records.append(result)
            notify({"type": "item_complete", **result})
        except Exception as exc:  # noqa: BLE001
            failed += 1
            failure = {
                "object_type": object_type,
                "source_key": item.get("source_key"),
                "status": "failed",
                "message": str(exc),
            }
            records.append(failure)
            errors.append(failure)
            notify({"type": "item_failed", **failure})

    try:
        await _reorder_objects(client, reorder_buckets)
    except Exception as exc:  # noqa: BLE001
        errors.append(
            {
                "object_type": "ordering",
                "source_key": "bulk_order",
                "status": "failed",
                "message": f"Ordering update failed: {exc}",
            }
        )
        failed += 1

    status = "failed" if failed > 0 else "completed"
    return {
        "status": status,
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "errors": errors,
        "records": records,
    }
