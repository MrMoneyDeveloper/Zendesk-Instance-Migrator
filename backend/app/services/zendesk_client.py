from __future__ import annotations

import base64
import asyncio
import random
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.settings import get_settings
from app.models.schemas import ZendeskCredentials


class ZendeskApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


@dataclass
class ZendeskApiResponse:
    status_code: int
    data: Any
    headers: dict[str, str]


def resolve_base_url(credentials: ZendeskCredentials) -> str:
    if credentials.base_url:
        return credentials.base_url.rstrip("/")
    return f"https://{credentials.subdomain}.zendesk.com"


def _authorization_header(credentials: ZendeskCredentials) -> str:
    raw = f"{credentials.email}/token:{credentials.api_token}".encode("utf-8")
    return f"Basic {base64.b64encode(raw).decode('ascii')}"


def to_relative_path(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        if parsed.path:
            return f"{parsed.path}{f'?{parsed.query}' if parsed.query else ''}"
        return None
    return value


class ZendeskApiClient:
    def __init__(self, credentials: ZendeskCredentials):
        self.credentials = credentials
        self.base_url = resolve_base_url(credentials)
        self.authorization = _authorization_header(credentials)
        settings = get_settings()
        self.timeout = settings.request_timeout_seconds
        self.max_retries = settings.request_retries
        self.backoff_ms = settings.request_backoff_ms

    async def request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | list | None = None,
        params: dict[str, Any] | None = None,
    ) -> ZendeskApiResponse:
        if not path:
            raise ZendeskApiError("Zendesk API path is required.")

        normalized_path = path if path.startswith("/") else f"/{path}"
        url = f"{self.base_url}{normalized_path}"
        headers = {
            "Authorization": self.authorization,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        for attempt in range(self.max_retries + 1):
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(
                    method.upper(),
                    url,
                    headers=headers,
                    params=params,
                    json=json_body,
                )

            if response.status_code == 429 and attempt < self.max_retries:
                retry_after = response.headers.get("Retry-After")
                retry_ms = None
                if retry_after:
                    try:
                        retry_ms = int(float(retry_after) * 1000)
                    except ValueError:
                        retry_ms = None
                if retry_ms is None:
                    retry_ms = int(self.backoff_ms * (2 ** attempt) + random.randint(0, 250))
                await asyncio.sleep(max(retry_ms, 50) / 1000.0)
                continue

            payload = None
            if response.text:
                try:
                    payload = response.json()
                except ValueError:
                    payload = response.text

            if response.status_code >= 400:
                detail = f"Zendesk API request failed: {response.status_code}"
                if isinstance(payload, dict):
                    error = payload.get("error") or payload.get("title")
                    description = payload.get("description") or payload.get("detail")
                    if error:
                        detail = f"{detail} ({error})"
                    if description:
                        detail = f"{detail}: {description}"
                raise ZendeskApiError(detail, status_code=response.status_code, payload=payload)

            return ZendeskApiResponse(
                status_code=response.status_code,
                data=payload,
                headers=dict(response.headers),
            )

        raise ZendeskApiError("Zendesk API retry limit exceeded.")

    async def fetch_all_pages(self, path: str, *, roots: list[str], params: dict[str, Any] | None = None) -> list[dict]:
        items: list[dict] = []
        next_path: str | None = path
        next_params = params or {}

        while next_path:
            response = await self.request("GET", next_path, params=next_params)
            payload = response.data if isinstance(response.data, dict) else {}

            page_items = []
            for root in roots:
                value = payload.get(root)
                if isinstance(value, list):
                    page_items = value
                    break

            for entry in page_items:
                if isinstance(entry, dict):
                    items.append(entry)

            next_url = payload.get("next_page")
            if not next_url and isinstance(payload.get("links"), dict):
                next_url = payload["links"].get("next")
            next_path = to_relative_path(next_url)
            next_params = {}

        return items

    async def validate_credentials(self) -> dict[str, Any]:
        response = await self.request("GET", "/api/v2/users/me.json")
        payload = response.data if isinstance(response.data, dict) else {}
        user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
        return {
            "ok": True,
            "detail": "Credentials validated.",
            "base_url": self.base_url,
            "account_name": payload.get("account") if isinstance(payload.get("account"), str) else None,
            "authenticated_user": user.get("email") or user.get("name"),
            "authenticated_user_role": user.get("role"),
            "http_status": response.status_code,
        }
