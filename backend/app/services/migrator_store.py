from __future__ import annotations

from datetime import UTC, datetime
from threading import Lock
from uuid import uuid4

from app.models.schemas import RunStatusResponse


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class MigratorStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._plans: dict[str, dict] = {}
        self._runs: dict[str, dict] = {}

    def create_plan(self, payload: dict) -> str:
        plan_id = str(uuid4())
        with self._lock:
            self._plans[plan_id] = payload
        return plan_id

    def get_plan(self, plan_id: str) -> dict | None:
        with self._lock:
            return self._plans.get(plan_id)

    def create_run(self, *, kind: str, plan_id: str | None = None) -> str:
        run_id = str(uuid4())
        now = _now_iso()
        with self._lock:
            self._runs[run_id] = {
                "id": run_id,
                "kind": kind,
                "status": "pending",
                "progress": {},
                "summary": {},
                "logs": [],
                "report": None,
                "plan_id": plan_id,
                "created_at": now,
                "updated_at": now,
            }
        return run_id

    def append_log(self, run_id: str, entry: dict) -> None:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                return
            run["logs"].append(entry)
            run["updated_at"] = _now_iso()

    def update_run(
        self,
        run_id: str,
        *,
        status: str | None = None,
        progress: dict | None = None,
        summary: dict | None = None,
        report: dict | None = None,
        plan_id: str | None = None,
    ) -> None:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                return
            if status is not None:
                run["status"] = status
            if progress is not None:
                run["progress"] = progress
            if summary is not None:
                run["summary"] = summary
            if report is not None:
                run["report"] = report
            if plan_id is not None:
                run["plan_id"] = plan_id
            run["updated_at"] = _now_iso()

    def get_run(self, run_id: str) -> RunStatusResponse | None:
        with self._lock:
            data = self._runs.get(run_id)
            if not data:
                return None
            return RunStatusResponse(**data)


store = MigratorStore()
