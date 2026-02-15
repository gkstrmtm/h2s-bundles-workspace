from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from flask import Blueprint, jsonify, request
import os


# =====================================================================================
# Mock backend implementing the Offer Factory contract.
#
# Deterministic brief rule (Option A):
# - offers.currentBriefDeliverableId is the single source of truth.
# - aggregator returns `brief` ONLY if that deliverable exists and is linked.
# - duplicates are detected and surfaced in `integrity.warnings`.
#
# Migration/backfill model:
# - deliverables.offerId is the hardened linkage.
# - legacy metadata.offerId may exist and is used ONLY for backfill suggestions.
# - anything unlinked becomes visible in `integrity.unlinkedDeliverables`.
# =====================================================================================


@dataclass
class Page:
    items: List[Dict[str, Any]]
    next_cursor: str
    total: int


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _get_correlation_id() -> str:
    return request.headers.get("X-Correlation-Id") or str(uuid.uuid4())


def _paginate(items: List[Dict[str, Any]], cursor: str, limit: int) -> Page:
    start = 0
    if cursor:
        try:
            start = int(cursor)
        except ValueError:
            start = 0
    page_items = items[start : start + limit]
    next_cursor = str(start + limit) if start + limit < len(items) else ""
    return Page(items=page_items, next_cursor=next_cursor, total=len(items))


def create_mock_blueprint() -> Blueprint:
    bp = Blueprint("offer_factory_mock", __name__)

    # ------------------------------
    # In-memory mock data
    # ------------------------------
    offers: Dict[str, Dict[str, Any]] = {}
    deliverables: Dict[str, Dict[str, Any]] = {}
    resources: Dict[str, Dict[str, Any]] = {}
    offer_resource_links: Dict[Tuple[str, str], Dict[str, Any]] = {}
    frameworks_by_offer: Dict[str, List[Dict[str, Any]]] = {}

    def seed() -> None:
        nonlocal offers, deliverables, resources, offer_resource_links, frameworks_by_offer

        def add_offer(name: str, status: str) -> str:
            oid = _make_id("offer")
            offers[oid] = {
                "offerId": oid,
                "offerName": name,
                "status": status,
                "snapshot": {
                    "snapshotId": _make_id("snap"),
                    "summary": "Pricing + positioning snapshot",
                    "createdAt": _now_iso(),
                },
                "currentBriefDeliverableId": None,
                "createdAt": _now_iso(),
                "updatedAt": _now_iso(),
                "provenance": {"source": "mock", "createdBy": "seed"},
            }
            frameworks_by_offer[oid] = [
                {
                    "frameworkId": _make_id("fw"),
                    "title": "Primary Angle",
                    "bodyPreview": "Hook → Problem → Solution → CTA",
                    "generatedFromSnapshotId": offers[oid]["snapshot"]["snapshotId"],
                    "provenance": {"generatedBy": "mock", "model": "n/a", "generatedAt": _now_iso()},
                    "updatedAt": _now_iso(),
                }
            ]
            return oid

        o1 = add_offer("TV Mount - Standard Bundle", "active")
        o2 = add_offer("Camera Install - Premium", "draft")
        o3 = add_offer("Smart Lock - Launch", "paused")

        # Deliverables
        def add_deliverable(
            offer_id: Optional[str],
            type_: str,
            status: str,
            title: str,
            body: str,
            *,
            legacy_metadata_offer_id: Optional[str] = None,
        ) -> str:
            did = _make_id("del")
            deliverables[did] = {
                "deliverableId": did,
                "offerId": offer_id,
                "type": type_,
                "status": status,
                "title": title,
                "body": body,
                "metadata": {"offerId": legacy_metadata_offer_id} if legacy_metadata_offer_id else {},
                "createdAt": _now_iso(),
                "updatedAt": _now_iso(),
            }
            return did

        # Briefs (create a duplicate scenario in mock)
        brief1 = add_deliverable(o1, "offer_brief", "published", "Brief (Published)", "Published brief body for TV Mount.")
        add_deliverable(o1, "offer_brief", "draft", "Brief (Draft)", "Draft brief body for TV Mount.")
        offers[o1]["currentBriefDeliverableId"] = brief1

        # Unlinked deliverable w/ legacy metadata for repair flow
        add_deliverable(None, "deliverable", "draft", "Unlinked: Ad Copy", "Legacy-linked via metadata.", legacy_metadata_offer_id=o2)

        # Add a bunch of deliverables for pagination
        for i in range(120):
            add_deliverable(o1, "deliverable", "draft", f"D{i+1:03d} - Variant", "Body omitted")

        # Resources
        def add_resource(filename: str, tags: List[str]) -> str:
            rid = _make_id("res")
            resources[rid] = {
                "resourceId": rid,
                "filename": filename,
                "mime": "image/jpeg" if filename.lower().endswith(".jpg") else "video/mp4",
                "tags": tags,
                "fileId": _make_id("file"),
                "thumbFileId": _make_id("thumb"),
                "createdAt": _now_iso(),
                "updatedAt": _now_iso(),
            }
            return rid

        r1 = add_resource("hero-tv.jpg", ["hero", "tv"])
        r2 = add_resource("before-after.jpg", ["proof", "tv"])
        r3 = add_resource("camera-demo.mp4", ["camera", "video"])

        # Link some resources
        offer_resource_links[(o1, r1)] = {"offerId": o1, "resourceId": r1, "createdAt": _now_iso()}
        offer_resource_links[(o1, r2)] = {"offerId": o1, "resourceId": r2, "createdAt": _now_iso()}
        offer_resource_links[(o2, r3)] = {"offerId": o2, "resourceId": r3, "createdAt": _now_iso()}

    seed()

    # ------------------------------
    # Helpers
    # ------------------------------
    def _require_auth() -> Optional[Any]:
        # Demo auth: allow forcing 401 via env var for UI testing.
        # Set OFFER_FACTORY_FORCE_401=1 to validate auth-lock behavior.
        if os.getenv("OFFER_FACTORY_FORCE_401", "").strip() == "1":
            return jsonify({"error": "unauthorized"}), 401
        return None

    def _deliverables_for_offer(offer_id: str) -> List[Dict[str, Any]]:
        return [d for d in deliverables.values() if d.get("offerId") == offer_id]

    def _resources_for_offer(offer_id: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for (oid, rid), _link in offer_resource_links.items():
            if oid == offer_id and rid in resources:
                out.append(resources[rid])
        # stable ordering
        out.sort(key=lambda r: r.get("updatedAt", ""), reverse=True)
        return out

    def _brief_for_offer(offer: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
        # returns (brief, brief_candidates)
        offer_id = offer["offerId"]
        candidates = [d for d in _deliverables_for_offer(offer_id) if d.get("type") == "offer_brief"]
        candidates.sort(key=lambda d: d.get("updatedAt", ""), reverse=True)
        brief_id = offer.get("currentBriefDeliverableId")
        brief = deliverables.get(brief_id) if brief_id else None
        if brief and brief.get("offerId") != offer_id:
            brief = None
        return brief, candidates

    def _integrity_report(offer: Dict[str, Any]) -> Dict[str, Any]:
        offer_id = offer["offerId"]
        warnings: List[Dict[str, Any]] = []

        brief, brief_candidates = _brief_for_offer(offer)
        if offer.get("currentBriefDeliverableId") and not brief:
            warnings.append(
                {
                    "code": "BRIEF_POINTER_BROKEN",
                    "severity": "error",
                    "message": "Offer points to a brief that is missing or not linked.",
                }
            )
        if len(brief_candidates) > 1:
            warnings.append(
                {
                    "code": "BRIEF_DUPLICATES",
                    "severity": "warning",
                    "message": f"Multiple offer briefs detected ({len(brief_candidates)}). Current is controlled by currentBriefDeliverableId.",
                    "details": {"candidateIds": [b["deliverableId"] for b in brief_candidates]},
                }
            )

        # Framework snapshot mismatch
        frameworks = frameworks_by_offer.get(offer_id, [])
        snap_id = offer.get("snapshot", {}).get("snapshotId")
        stale = [f for f in frameworks if f.get("generatedFromSnapshotId") != snap_id]
        if stale:
            warnings.append(
                {
                    "code": "FRAMEWORK_SNAPSHOT_MISMATCH",
                    "severity": "warning",
                    "message": "Some frameworks were generated from a different snapshot.",
                    "details": {"staleFrameworkIds": [f.get("frameworkId") for f in stale]},
                }
            )

        # Unlinked deliverables (global view surfaced inside offer workspace as repair candidates)
        unlinked = [d for d in deliverables.values() if not d.get("offerId")]
        # Provide "suggestedOfferId" if legacy metadata present
        unlinked_items = []
        for d in unlinked:
            suggested = (d.get("metadata") or {}).get("offerId")
            unlinked_items.append(
                {
                    "deliverableId": d["deliverableId"],
                    "type": d.get("type"),
                    "status": d.get("status"),
                    "title": d.get("title"),
                    "updatedAt": d.get("updatedAt"),
                    "suggestedOfferId": suggested,
                }
            )

        return {
            "warnings": warnings,
            "counts": {
                "deliverablesLinked": len(_deliverables_for_offer(offer_id)),
                "resourcesLinked": len(_resources_for_offer(offer_id)),
                "briefCandidates": len(brief_candidates),
                "unlinkedDeliverables": len(unlinked_items),
            },
            "repair": {
                "unlinkedDeliverables": {
                    "items": unlinked_items[:50],
                    "nextCursor": "50" if len(unlinked_items) > 50 else "",
                    "total": len(unlinked_items),
                }
            },
        }

    # ------------------------------
    # Endpoints
    # ------------------------------
    @bp.get("/api/offers")
    def list_offers():
        auth = _require_auth()
        if auth is not None:
            return auth

        q = (request.args.get("query") or "").lower().strip()
        cursor = request.args.get("cursor") or ""
        status = (request.args.get("status") or "").strip().lower()
        all_items = list(offers.values())
        all_items.sort(key=lambda o: o.get("updatedAt", ""), reverse=True)
        if q:
            all_items = [o for o in all_items if q in o.get("offerName", "").lower() or q in o.get("offerId", "").lower()]
        if status:
            all_items = [o for o in all_items if (o.get("status") or "").lower() == status]

        page = _paginate(all_items, cursor, limit=20)
        return jsonify(
            {
                "items": [
                    {
                        "offerId": o["offerId"],
                        "offerName": o["offerName"],
                        "status": o.get("status"),
                        "updatedAt": o.get("updatedAt"),
                        "snapshot": o.get("snapshot"),
                    }
                    for o in page.items
                ],
                "nextCursor": page.next_cursor,
                "total": page.total,
            }
        )

    @bp.get("/api/workspace/offers/<offer_id>")
    def workspace_offer(offer_id: str):
        auth = _require_auth()
        if auth is not None:
            return auth

        cid = _get_correlation_id()
        t0 = time.time()

        offer = offers.get(offer_id)
        if not offer:
            return jsonify({"error": "not_found", "correlationId": cid}), 404

        errors: List[Dict[str, Any]] = []

        # Offer + frameworks
        t_offer = time.time()
        offer_summary = dict(offer)
        offer_summary["_kind"] = "offer"
        offer_ms = int((time.time() - t_offer) * 1000)

        t_fw = time.time()
        fw_items = frameworks_by_offer.get(offer_id, [])
        fw_ms = int((time.time() - t_fw) * 1000)

        # Brief selection (deterministic)
        t_br = time.time()
        brief, _candidates = _brief_for_offer(offer)
        brief_ms = int((time.time() - t_br) * 1000)

        # Deliverables page
        t_del = time.time()
        del_items = _deliverables_for_offer(offer_id)
        del_items.sort(key=lambda d: d.get("updatedAt", ""), reverse=True)
        del_page = _paginate(del_items, cursor="", limit=25)
        del_ms = int((time.time() - t_del) * 1000)

        # Resources page
        t_res = time.time()
        res_items = _resources_for_offer(offer_id)
        res_page = _paginate(res_items, cursor="", limit=24)
        res_ms = int((time.time() - t_res) * 1000)

        integrity = _integrity_report(offer)

        total_ms = int((time.time() - t0) * 1000)

        return jsonify(
            {
                "offer": {
                    "offerId": offer_summary["offerId"],
                    "offerName": offer_summary["offerName"],
                    "status": offer_summary.get("status"),
                    "snapshot": offer_summary.get("snapshot"),
                    "currentBriefDeliverableId": offer_summary.get("currentBriefDeliverableId"),
                    "createdAt": offer_summary.get("createdAt"),
                    "updatedAt": offer_summary.get("updatedAt"),
                    "provenance": offer_summary.get("provenance"),
                },
                "frameworks": {
                    "items": fw_items,
                    "generatedFromSnapshotId": offer_summary.get("snapshot", {}).get("snapshotId"),
                },
                "brief": (
                    {
                        "deliverableId": brief["deliverableId"],
                        "type": brief.get("type"),
                        "status": brief.get("status"),
                        "title": brief.get("title"),
                        "updatedAt": brief.get("updatedAt"),
                        "bodyPreview": (brief.get("body") or "")[:240],
                    }
                    if brief
                    else None
                ),
                "deliverables": {
                    "items": [
                        {
                            "deliverableId": d["deliverableId"],
                            "type": d.get("type"),
                            "status": d.get("status"),
                            "title": d.get("title"),
                            "updatedAt": d.get("updatedAt"),
                        }
                        for d in del_page.items
                    ],
                    "nextCursor": del_page.next_cursor,
                    "total": del_page.total,
                },
                "resources": {
                    "items": [
                        {
                            "resourceId": r["resourceId"],
                            "filename": r.get("filename"),
                            "mime": r.get("mime"),
                            "tags": r.get("tags", []),
                            # Aggregator returns a display-ready thumbnail URL.
                            # UI may separately call /api/files/{fileId}/signed-url to refresh signed URLs.
                            "thumbUrl": "https://cdn.jsdelivr.net/gh/gkstrmtm/home2smart-assets@main/logo-180.png",
                            "fileId": r.get("fileId"),
                            "thumbFileId": r.get("thumbFileId"),
                            "createdAt": r.get("createdAt"),
                            "updatedAt": r.get("updatedAt"),
                        }
                        for r in res_page.items
                    ],
                    "nextCursor": res_page.next_cursor,
                    "total": res_page.total,
                },
                "integrity": integrity,
                "errors": errors,
                "debug": {
                    "correlationId": cid,
                    "timingsMs": {
                        "offer": offer_ms,
                        "frameworks": fw_ms,
                        "brief": brief_ms,
                        "deliverables": del_ms,
                        "resources": res_ms,
                        "total": total_ms,
                    },
                },
            }
        )

    @bp.get("/api/deliverables")
    def list_deliverables():
        auth = _require_auth()
        if auth is not None:
            return auth

        offer_id = request.args.get("offerId") or ""
        type_filter = (request.args.get("type") or "").strip()
        cursor = request.args.get("cursor") or ""

        items = [d for d in deliverables.values() if d.get("offerId") == offer_id] if offer_id else list(deliverables.values())
        if type_filter:
            items = [d for d in items if d.get("type") == type_filter]
        items.sort(key=lambda d: d.get("updatedAt", ""), reverse=True)

        page = _paginate(items, cursor, limit=50)
        return jsonify(
            {
                "items": [
                    {
                        "deliverableId": d["deliverableId"],
                        "offerId": d.get("offerId"),
                        "type": d.get("type"),
                        "status": d.get("status"),
                        "title": d.get("title"),
                        "updatedAt": d.get("updatedAt"),
                    }
                    for d in page.items
                ],
                "nextCursor": page.next_cursor,
                "total": page.total,
            }
        )

    @bp.get("/api/deliverables/<deliverable_id>")
    def get_deliverable(deliverable_id: str):
        auth = _require_auth()
        if auth is not None:
            return auth

        d = deliverables.get(deliverable_id)
        if not d:
            return jsonify({"error": "not_found"}), 404
        return jsonify(d)

    @bp.post("/api/deliverables:attach")
    def attach_deliverable():
        auth = _require_auth()
        if auth is not None:
            return auth

        payload = request.get_json(force=True, silent=True) or {}
        offer_id = payload.get("offerId")
        deliverable_id = payload.get("deliverableId")
        if not offer_id or not deliverable_id:
            return jsonify({"error": "missing_offerId_or_deliverableId"}), 400

        if offer_id not in offers or deliverable_id not in deliverables:
            return jsonify({"error": "not_found"}), 404

        deliverables[deliverable_id]["offerId"] = offer_id
        deliverables[deliverable_id]["updatedAt"] = _now_iso()
        return jsonify({"ok": True})

    @bp.post("/api/resources:attach")
    def attach_resource():
        auth = _require_auth()
        if auth is not None:
            return auth

        payload = request.get_json(force=True, silent=True) or {}
        offer_id = payload.get("offerId")
        resource_id = payload.get("resourceId")
        if not offer_id or not resource_id:
            return jsonify({"error": "missing_offerId_or_resourceId"}), 400
        if offer_id not in offers or resource_id not in resources:
            return jsonify({"error": "not_found"}), 404

        offer_resource_links[(offer_id, resource_id)] = {"offerId": offer_id, "resourceId": resource_id, "createdAt": _now_iso()}
        return jsonify({"ok": True})

    @bp.post("/api/resources:detach")
    def detach_resource():
        auth = _require_auth()
        if auth is not None:
            return auth

        payload = request.get_json(force=True, silent=True) or {}
        offer_id = payload.get("offerId")
        resource_id = payload.get("resourceId")
        if not offer_id or not resource_id:
            return jsonify({"error": "missing_offerId_or_resourceId"}), 400

        offer_resource_links.pop((offer_id, resource_id), None)
        return jsonify({"ok": True})

    @bp.get("/api/resources")
    def list_resources():
        auth = _require_auth()
        if auth is not None:
            return auth

        offer_id = (request.args.get("offerId") or "").strip()
        cursor = request.args.get("cursor") or ""
        query = (request.args.get("query") or "").lower().strip()

        if offer_id:
            items = _resources_for_offer(offer_id)
        else:
            items = list(resources.values())
            items.sort(key=lambda r: r.get("updatedAt", ""), reverse=True)

        if query:
            items = [r for r in items if query in (r.get("filename") or "").lower() or query in (r.get("resourceId") or "").lower()]

        page = _paginate(items, cursor, limit=48)
        return jsonify(
            {
                "items": [
                    {
                        "resourceId": r["resourceId"],
                        "filename": r.get("filename"),
                        "mime": r.get("mime"),
                        "tags": r.get("tags", []),
                        "thumbUrl": "https://cdn.jsdelivr.net/gh/gkstrmtm/home2smart-assets@main/logo-180.png",
                        "fileId": r.get("fileId"),
                        "thumbFileId": r.get("thumbFileId"),
                        "createdAt": r.get("createdAt"),
                        "updatedAt": r.get("updatedAt"),
                    }
                    for r in page.items
                ],
                "nextCursor": page.next_cursor,
                "total": page.total,
            }
        )

    @bp.get("/api/files/<file_id>/signed-url")
    def signed_url(file_id: str):
        auth = _require_auth()
        if auth is not None:
            return auth

        # Mock: return a stable placeholder image URL.
        # In production, return a time-limited signed URL.
        return jsonify(
            {
                "fileId": file_id,
                "url": "https://cdn.jsdelivr.net/gh/gkstrmtm/home2smart-assets@main/logo-180.png",
                "expiresAt": _now_iso(),
            }
        )

    @bp.post("/api/offers/<offer_id>/frameworks:generate")
    def frameworks_generate(offer_id: str):
        auth = _require_auth()
        if auth is not None:
            return auth

        offer = offers.get(offer_id)
        if not offer:
            return jsonify({"error": "not_found"}), 404

        fw = {
            "frameworkId": _make_id("fw"),
            "title": "Regenerated Framework",
            "bodyPreview": "New framework generated",
            "generatedFromSnapshotId": offer.get("snapshot", {}).get("snapshotId"),
            "provenance": {"generatedBy": "mock", "generatedAt": _now_iso()},
            "updatedAt": _now_iso(),
        }
        frameworks_by_offer.setdefault(offer_id, []).insert(0, fw)
        offers[offer_id]["updatedAt"] = _now_iso()
        return jsonify({"ok": True, "framework": fw})

    @bp.post("/api/offers/<offer_id>/brief:publish_or_replace")
    def brief_publish_or_replace(offer_id: str):
        auth = _require_auth()
        if auth is not None:
            return auth

        offer = offers.get(offer_id)
        if not offer:
            return jsonify({"error": "not_found"}), 404

        payload = request.get_json(force=True, silent=True) or {}
        deliverable_id = payload.get("deliverableId")
        body = payload.get("body")

        if deliverable_id:
            d = deliverables.get(deliverable_id)
            if not d:
                return jsonify({"error": "deliverable_not_found"}), 404
            d["offerId"] = offer_id
            d["type"] = "offer_brief"
            d["status"] = "published"
            d["updatedAt"] = _now_iso()
            offer["currentBriefDeliverableId"] = deliverable_id
            offer["updatedAt"] = _now_iso()
            return jsonify({"ok": True, "currentBriefDeliverableId": deliverable_id})

        if body is None:
            return jsonify({"error": "missing_deliverableId_or_body"}), 400

        # Create a new brief deliverable
        did = _make_id("del")
        deliverables[did] = {
            "deliverableId": did,
            "offerId": offer_id,
            "type": "offer_brief",
            "status": "published",
            "title": "Offer Brief",
            "body": body,
            "metadata": {},
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
        }
        offer["currentBriefDeliverableId"] = did
        offer["updatedAt"] = _now_iso()
        return jsonify({"ok": True, "currentBriefDeliverableId": did})

    return bp
