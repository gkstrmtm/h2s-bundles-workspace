from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import requests


@dataclass(frozen=True)
class ApiResult:
    ok: bool
    status: int
    data: Optional[Dict[str, Any]]
    error: Optional[str]
    correlation_id: str
    elapsed_ms: int


class WorkspaceApiClient:
    """Centralized HTTP client.

    Correctness checklist (enforced by design):
    - Single-call hydration for the workspace view: `GET /api/workspace/offers/{offerId}`.
    - Calm auth behavior: on 401, DO NOT retry-loop; surface a single locked state.
    - Partial failure tolerant: aggregator may return `errors[]` while still `ok=true`.
    - Correlation ID per workspace load: propagated via `X-Correlation-Id`.
    """

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._session = requests.Session()

    @staticmethod
    def from_env(default_base_url: str = "") -> "WorkspaceApiClient":
        base = os.getenv("OFFER_FACTORY_API_BASE", "").strip() or default_base_url
        base = base.rstrip("/")
        return WorkspaceApiClient(base)

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self.base_url}{path}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        correlation_id: Optional[str] = None,
        json_body: Optional[Dict[str, Any]] = None,
        timeout_s: int = 15,
        allow_retry: bool = True,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        """Returns (result, next_auth_locked)."""

        if auth_locked:
            # Hard stop: never create request storms.
            cid = correlation_id or str(uuid.uuid4())
            return (
                ApiResult(
                    ok=False,
                    status=0,
                    data=None,
                    error="AUTH_LOCKED",
                    correlation_id=cid,
                    elapsed_ms=0,
                ),
                True,
            )

        cid = correlation_id or str(uuid.uuid4())
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Correlation-Id": cid,
        }

        start = time.time()
        try:
            resp = self._session.request(
                method,
                self._url(path),
                headers=headers,
                data=json.dumps(json_body) if json_body is not None else None,
                timeout=timeout_s,
            )
        except requests.RequestException as e:
            elapsed_ms = int((time.time() - start) * 1000)
            return (
                ApiResult(
                    ok=False,
                    status=0,
                    data=None,
                    error=str(e),
                    correlation_id=cid,
                    elapsed_ms=elapsed_ms,
                ),
                False,
            )

        elapsed_ms = int((time.time() - start) * 1000)

        if resp.status_code == 401:
            # Calm auth behavior: lock until user explicitly retries.
            return (
                ApiResult(
                    ok=False,
                    status=401,
                    data=None,
                    error="UNAUTHORIZED",
                    correlation_id=cid,
                    elapsed_ms=elapsed_ms,
                ),
                True,
            )

        # Light retry for transient backend hiccups (never for 401).
        if allow_retry and resp.status_code in (429, 502, 503, 504):
            time.sleep(0.35)
            return self._request(
                method,
                path,
                correlation_id=cid,
                json_body=json_body,
                timeout_s=timeout_s,
                allow_retry=False,
                auth_locked=False,
            )

        if not (200 <= resp.status_code < 300):
            err = resp.text.strip()[:800]
            return (
                ApiResult(
                    ok=False,
                    status=resp.status_code,
                    data=None,
                    error=err or "HTTP_ERROR",
                    correlation_id=cid,
                    elapsed_ms=elapsed_ms,
                ),
                False,
            )

        try:
            payload = resp.json() if resp.text else {}
        except ValueError:
            payload = {}

        return (
            ApiResult(
                ok=True,
                status=resp.status_code,
                data=payload,
                error=None,
                correlation_id=cid,
                elapsed_ms=elapsed_ms,
            ),
            False,
        )

    def list_offers(
        self,
        *,
        query: str = "",
        cursor: str = "",
        status: str = "",
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        path = (
            f"/api/offers?query={requests.utils.quote(query)}"
            f"&cursor={requests.utils.quote(cursor)}&status={requests.utils.quote(status)}"
        )
        return self._request("GET", path, correlation_id=correlation_id, auth_locked=auth_locked)

    def get_workspace_offer(
        self,
        offer_id: str,
        *,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        return self._request(
            "GET",
            f"/api/workspace/offers/{offer_id}",
            correlation_id=correlation_id,
            auth_locked=auth_locked,
        )

    def generate_frameworks(
        self,
        offer_id: str,
        *,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        return self._request(
            "POST",
            f"/api/offers/{offer_id}/frameworks:generate",
            correlation_id=correlation_id,
            json_body={},
            auth_locked=auth_locked,
        )

    def publish_or_replace_brief(
        self,
        offer_id: str,
        *,
        deliverable_id: Optional[str] = None,
        body: Optional[str] = None,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        return self._request(
            "POST",
            f"/api/offers/{offer_id}/brief:publish_or_replace",
            correlation_id=correlation_id,
            json_body={"deliverableId": deliverable_id, "body": body},
            auth_locked=auth_locked,
        )

    def attach_resource(
        self,
        offer_id: str,
        resource_id: str,
        *,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        return self._request(
            "POST",
            "/api/resources:attach",
            correlation_id=correlation_id,
            json_body={"offerId": offer_id, "resourceId": resource_id},
            auth_locked=auth_locked,
        )

    def detach_resource(
        self,
        offer_id: str,
        resource_id: str,
        *,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        return self._request(
            "POST",
            "/api/resources:detach",
            correlation_id=correlation_id,
            json_body={"offerId": offer_id, "resourceId": resource_id},
            auth_locked=auth_locked,
        )

    def relink_deliverable(
        self,
        offer_id: str,
        deliverable_id: str,
        *,
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        # Repair-only endpoint (required by repair mode).
        return self._request(
            "POST",
            "/api/deliverables:attach",
            correlation_id=correlation_id,
            json_body={"offerId": offer_id, "deliverableId": deliverable_id},
            auth_locked=auth_locked,
        )

    def get_deliverables_page(
        self,
        *,
        offer_id: str,
        type_filter: str = "",
        cursor: str = "",
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        path = (
            f"/api/deliverables?offerId={requests.utils.quote(offer_id)}"
            f"&type={requests.utils.quote(type_filter)}&cursor={requests.utils.quote(cursor)}"
        )
        return self._request("GET", path, correlation_id=correlation_id, auth_locked=auth_locked)

    def get_resources_page(
        self,
        *,
        offer_id: str,
        cursor: str = "",
        query: str = "",
        correlation_id: Optional[str] = None,
        auth_locked: bool = False,
    ) -> Tuple[ApiResult, bool]:
        path = (
            f"/api/resources?offerId={requests.utils.quote(offer_id)}"
            f"&cursor={requests.utils.quote(cursor)}&query={requests.utils.quote(query)}"
        )
        return self._request("GET", path, correlation_id=correlation_id, auth_locked=auth_locked)
