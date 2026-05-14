from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

MigrationStatus = Literal["pending", "running", "completed", "failed"]
PlanAction = Literal["create", "update", "skip"]


class ZendeskCredentials(BaseModel):
    base_url: str | None = None
    subdomain: str | None = None
    email: str = Field(..., min_length=3, max_length=254)
    api_token: str = Field(..., min_length=3, max_length=2048)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        if not cleaned.startswith("http://") and not cleaned.startswith("https://"):
            cleaned = f"https://{cleaned}"
        return cleaned.rstrip("/")

    @field_validator("subdomain")
    @classmethod
    def normalize_subdomain(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lower()
        if cleaned.startswith("https://"):
            cleaned = cleaned.removeprefix("https://")
        if cleaned.startswith("http://"):
            cleaned = cleaned.removeprefix("http://")
        if cleaned.endswith(".zendesk.com"):
            cleaned = cleaned.removesuffix(".zendesk.com")
        cleaned = cleaned.strip("/")
        return cleaned or None

    @field_validator("email", "api_token")
    @classmethod
    def trim_credentials(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_instance(self):
        if not self.base_url and not self.subdomain:
            raise ValueError("Provide either base_url or subdomain.")
        return self


class MigrationOptions(BaseModel):
    active_only: bool = True
    overwrite_existing: bool = True
    include_omnichannel: bool = True


class ValidateRequest(BaseModel):
    source: ZendeskCredentials
    target: ZendeskCredentials


class CredentialValidationResult(BaseModel):
    ok: bool
    detail: str
    base_url: str
    account_name: str | None = None
    authenticated_user: str | None = None
    authenticated_user_role: str | None = None
    http_status: int | None = None


class ValidateResponse(BaseModel):
    source: CredentialValidationResult
    target: CredentialValidationResult


class MigrationPlanItem(BaseModel):
    object_type: str
    source_key: str
    action: PlanAction
    dependency_refs: list[str] = Field(default_factory=list)
    reason: str
    context: dict[str, Any] = Field(default_factory=dict)
    source_item: dict[str, Any] = Field(default_factory=dict)
    match: dict[str, Any] | None = None


class DryRunRequest(BaseModel):
    source: ZendeskCredentials
    target: ZendeskCredentials
    options: MigrationOptions = Field(default_factory=MigrationOptions)


class DryRunResponse(BaseModel):
    plan_id: str
    run_id: str
    execution_order: list[str]
    summary_by_type: dict[str, dict[str, int]]
    totals: dict[str, int]
    notes: list[str]
    plan_items: list[MigrationPlanItem]


class ExecuteRequest(BaseModel):
    plan_id: str | None = None
    source: ZendeskCredentials
    target: ZendeskCredentials
    options: MigrationOptions = Field(default_factory=MigrationOptions)


class MigrationRunResult(BaseModel):
    status: Literal["completed", "failed"]
    created: int
    updated: int
    skipped: int
    failed: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


class RunStatusResponse(BaseModel):
    id: str
    kind: Literal["dry_run", "execute"]
    status: MigrationStatus
    progress: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    logs: list[dict[str, Any]] = Field(default_factory=list)
    report: dict[str, Any] | None = None
    plan_id: str | None = None
    created_at: str
    updated_at: str
