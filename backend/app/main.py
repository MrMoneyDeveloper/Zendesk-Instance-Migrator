from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from typing import Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from app.core.settings import get_settings
from app.routes.migrator import router as migrator_router
from app.services.runner_session import RunnerSessionError, RunnerSessionManager

settings = get_settings()
runner_session = RunnerSessionManager(settings)

app = FastAPI(title=settings.app_name)
app.state.runner_session = runner_session
app.state.watchdog_task = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.local_dev_origins),
    allow_origin_regex=r"^https://([a-z0-9-]+\.)?zendesk\.com$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(migrator_router, prefix="/api")


async def _shutdown_watchdog() -> None:
    while True:
        await asyncio.sleep(1.0)
        reason = runner_session.get_shutdown_reason_if_due()
        if reason:
            print(f"[runner] shutdown requested: {reason}", flush=True)
            await asyncio.sleep(0.05)
            os._exit(0)


@app.on_event("startup")
async def startup_event() -> None:
    app.state.watchdog_task = asyncio.create_task(_shutdown_watchdog())
    print(
        "[runner] Local runner ready on "
        f"http://{settings.runner_host}:{settings.runner_port}",
        flush=True,
    )
    print(f"[runner] Approval PIN: {runner_session.console_pin}", flush=True)


@app.on_event("shutdown")
async def shutdown_event() -> None:
    task = app.state.watchdog_task
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


@app.get("/")
def root():
    return runner_session.health_payload()


@app.get("/health")
def health():
    return runner_session.health_payload()


@app.post("/session/approve")
def approve_session(payload: dict[str, Any]):
    pin = str(payload.get("pin") if isinstance(payload, dict) else "").strip()
    if not pin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PIN is required.",
        )

    try:
        session_token, expires_at = runner_session.approve(pin)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    except RunnerSessionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return {
        "sessionToken": session_token,
        "expiresAt": expires_at.isoformat(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.runner_host,
        port=settings.runner_port,
    )
