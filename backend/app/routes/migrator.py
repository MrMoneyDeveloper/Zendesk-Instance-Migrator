from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status

from app.models.schemas import (
    DryRunRequest,
    DryRunResponse,
    ExecuteRequest,
    MigrationRunResult,
    RunStatusResponse,
    ValidateRequest,
    ValidateResponse,
)
from app.services.migration_engine import (
    build_migration_plan,
    execute_migration_plan,
    load_state,
)
from app.services.migrator_store import store
from app.services.zendesk_client import ZendeskApiClient, ZendeskApiError

router = APIRouter(prefix="/migrator", tags=["migrator"])


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _enforce_session_token(request: Request) -> None:
    runner_session = request.app.state.runner_session
    token = (
        request.headers.get("X-Session-Token")
        or request.headers.get("x-session-token")
        or ""
    ).strip()
    try:
        runner_session.require_token(token)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


@router.post("/validate", response_model=ValidateResponse)
async def validate_credentials(
    request: Request,
    payload: ValidateRequest,
) -> ValidateResponse:
    _enforce_session_token(request)

    source_client = ZendeskApiClient(payload.source)
    target_client = ZendeskApiClient(payload.target)

    try:
        source_result = await source_client.validate_credentials()
    except ZendeskApiError as exc:
        source_result = {
            "ok": False,
            "detail": str(exc),
            "base_url": source_client.base_url,
            "http_status": exc.status_code,
        }

    try:
        target_result = await target_client.validate_credentials()
    except ZendeskApiError as exc:
        target_result = {
            "ok": False,
            "detail": str(exc),
            "base_url": target_client.base_url,
            "http_status": exc.status_code,
        }

    return ValidateResponse(source=source_result, target=target_result)


@router.post("/dry-run", response_model=DryRunResponse)
async def dry_run_migration(
    request: Request,
    payload: DryRunRequest,
) -> DryRunResponse:
    _enforce_session_token(request)

    run_id = store.create_run(kind="dry_run")
    store.update_run(run_id, status="running", progress={"step": "fetch_source"})

    source_client = ZendeskApiClient(payload.source)
    target_client = ZendeskApiClient(payload.target)

    source_logs: list[dict] = []
    target_logs: list[dict] = []

    try:
        source_state = await load_state(
            source_client,
            include_omnichannel=payload.options.include_omnichannel,
            on_progress=lambda entry: source_logs.append({"phase": "source", **entry}),
        )
        for entry in source_logs:
            store.append_log(run_id, entry)

        store.update_run(run_id, progress={"step": "fetch_target"})
        target_state = await load_state(
            target_client,
            include_omnichannel=payload.options.include_omnichannel,
            on_progress=lambda entry: target_logs.append({"phase": "target", **entry}),
        )
        for entry in target_logs:
            store.append_log(run_id, entry)

        store.update_run(run_id, progress={"step": "build_plan"})
        plan = build_migration_plan(
            source_state=source_state,
            target_state=target_state,
            options=payload.options,
        )

        plan_id = store.create_plan(
            {
                "created_at": _now_iso(),
                "options": payload.options.model_dump(),
                "source_state": source_state,
                "target_state": target_state,
                "plan": plan,
            }
        )

        summary = {
            "totals": plan["totals"],
            "summary_by_type": plan["summary_by_type"],
        }
        store.update_run(
            run_id,
            status="completed",
            progress={"step": "complete"},
            summary=summary,
            plan_id=plan_id,
            report={
                "notes": plan["notes"],
                "execution_order": plan["execution_order"],
            },
        )

        return DryRunResponse(
            plan_id=plan_id,
            run_id=run_id,
            execution_order=plan["execution_order"],
            summary_by_type=plan["summary_by_type"],
            totals=plan["totals"],
            notes=plan["notes"],
            plan_items=plan["items"],
        )
    except Exception as exc:  # noqa: BLE001
        store.update_run(
            run_id,
            status="failed",
            progress={"step": "failed"},
            summary={"error": str(exc)},
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/execute", response_model=RunStatusResponse)
async def execute_migration(
    request: Request,
    payload: ExecuteRequest,
) -> RunStatusResponse:
    _enforce_session_token(request)
    runner_session = request.app.state.runner_session
    runner_session.mark_execute_started()

    run_id = store.create_run(kind="execute", plan_id=payload.plan_id)
    store.update_run(run_id, status="running", progress={"step": "prepare"})

    source_client = ZendeskApiClient(payload.source)
    target_client = ZendeskApiClient(payload.target)

    plan_data = None
    if payload.plan_id:
        plan_data = store.get_plan(payload.plan_id)

    try:
        if plan_data and isinstance(plan_data.get("plan"), dict):
            plan = plan_data["plan"]
        else:
            source_state = await load_state(
                source_client,
                include_omnichannel=payload.options.include_omnichannel,
            )
            target_state = await load_state(
                target_client,
                include_omnichannel=payload.options.include_omnichannel,
            )
            plan = build_migration_plan(
                source_state=source_state,
                target_state=target_state,
                options=payload.options,
            )
            new_plan_id = store.create_plan(
                {
                    "created_at": _now_iso(),
                    "options": payload.options.model_dump(),
                    "source_state": source_state,
                    "target_state": target_state,
                    "plan": plan,
                }
            )
            store.update_run(run_id, plan_id=new_plan_id)

        store.update_run(run_id, progress={"step": "execute"})
        execution_logs: list[dict] = []
        execution_result = await execute_migration_plan(
            target_client,
            plan,
            on_progress=lambda entry: execution_logs.append(entry),
        )
        for entry in execution_logs:
            store.append_log(run_id, entry)

        run_result = MigrationRunResult(**execution_result)
        final_status = "completed" if run_result.status == "completed" else "failed"
        report = {
            "executed_at": _now_iso(),
            "result": run_result.model_dump(),
            "plan_totals": plan["totals"],
            "notes": plan["notes"],
        }

        store.update_run(
            run_id,
            status=final_status,
            progress={"step": "complete"},
            summary=run_result.model_dump(),
            report=report,
        )
        runner_session.mark_execute_finished(final_status)
    except Exception as exc:  # noqa: BLE001
        store.update_run(
            run_id,
            status="failed",
            progress={"step": "failed"},
            summary={"error": str(exc)},
        )
        runner_session.mark_execute_finished("failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result = store.get_run(run_id)
    if not result:
        raise HTTPException(status_code=500, detail="Run not found after execution.")
    return result


@router.get("/run/{run_id}", response_model=RunStatusResponse)
async def get_run_status(
    request: Request,
    run_id: str,
) -> RunStatusResponse:
    _enforce_session_token(request)

    result = store.get_run(run_id)
    if not result:
        raise HTTPException(status_code=404, detail="Run not found.")
    return result
