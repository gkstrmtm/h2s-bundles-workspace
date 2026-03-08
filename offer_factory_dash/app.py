from __future__ import annotations

import json
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask

import dash
from dash import Dash, Input, Output, State, callback_context, dcc, html, dash_table, no_update

from api_client import WorkspaceApiClient
from mock_backend import create_mock_blueprint


def _safe_get(d: Optional[Dict[str, Any]], *path: str, default=None):
    cur: Any = d
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return default
        cur = cur[p]
    return cur


def _pill(text: str, kind: str = ""):
    cls = "of-pill"
    if kind == "warn":
        cls += " of-pill--warn"
    elif kind == "err":
        cls += " of-pill--err"
    elif kind == "ok":
        cls += " of-pill--ok"
    return html.Span(text, className=cls)


def _error_card(title: str, message: str, retry_id: Optional[str] = None):
    children = [html.H3(title, style={"margin": "0 0 8px 0"}), html.Div(message, style={"color": "var(--gray-700)"})]
    if retry_id:
        children.append(html.Div(style={"height": "12px"}))
        children.append(html.Button("Retry", id=retry_id, className="of-btn of-btn--primary"))
    return html.Div(className="of-card", children=children)


def _section_header(title: str, right: Optional[List[Any]] = None):
    return html.Div(
        className="of-header",
        children=[
            html.Div([
                html.H2(title, className="of-title"),
                html.P("Offer Factory workspace", className="of-subtitle"),
            ]),
            html.Div(className="of-row", children=(right or [])),
        ],
    )


def create_server() -> Flask:
    server = Flask(__name__)

    # Mock backend is enabled unless a real API base is provided.
    if not os.getenv("OFFER_FACTORY_API_BASE"):
        server.register_blueprint(create_mock_blueprint())

    return server


server = create_server()
app = Dash(__name__, server=server, suppress_callback_exceptions=True, title="Offer Factory")

# When running in mock mode (no OFFER_FACTORY_API_BASE), requests need an absolute URL.
# Default matches the `__main__` host/port; override with OFFER_FACTORY_SELF_BASE if needed.
_self_base = os.getenv("OFFER_FACTORY_SELF_BASE", "http://127.0.0.1:8050").strip().rstrip("/")
api_client = WorkspaceApiClient.from_env(default_base_url=_self_base)


def _rail_layout() -> html.Div:
    return html.Div(
        className="of-rail",
        children=[
            html.Div(
                className="of-card",
                children=[
                    html.Div(style={"fontWeight": 900, "fontSize": "18px"}, children="Offers"),
                    html.Div(style={"height": "10px"}),
                    dcc.Input(
                        id="of-offer-query",
                        className="of-input",
                        placeholder="Search offers by name or ID",
                        value="",
                        debounce=True,
                    ),
                    html.Div(style={"height": "10px"}),
                    dcc.Dropdown(
                        id="of-offer-status",
                        options=[
                            {"label": "All statuses", "value": ""},
                            {"label": "Active", "value": "active"},
                            {"label": "Draft", "value": "draft"},
                            {"label": "Paused", "value": "paused"},
                            {"label": "Archived", "value": "archived"},
                        ],
                        value="",
                        clearable=False,
                    ),
                    html.Div(style={"height": "10px"}),
                    html.Div(className="of-row", children=[
                        html.Button("Search", id="of-offer-search", className="of-btn of-btn--primary"),
                        html.Button("Clear", id="of-offer-clear", className="of-btn"),
                    ]),
                ],
            ),
            html.Div(style={"height": "12px"}),
            html.Div(id="of-offer-list"),
            html.Div(style={"height": "10px"}),
            html.Div(className="of-row", children=[
                html.Button("Prev", id="of-offers-prev", className="of-btn"),
                html.Button("Next", id="of-offers-next", className="of-btn"),
                html.Span(id="of-offers-pageinfo", style={"color": "var(--gray-600)", "fontSize": "12px"}),
            ]),
        ],
    )


def _main_layout() -> html.Div:
    return html.Div(
        className="of-main",
        children=[
            dcc.Store(id="of-auth-store", data={"locked": False, "last401": None}),
            dcc.Store(id="of-offers-store", data={"items": [], "cursor": "", "nextCursor": "", "total": 0, "query": ""}),
            dcc.Store(id="of-selected-offer", data={"offerId": None}),
            dcc.Store(id="of-workspace-store", data={"state": "empty", "payload": None, "correlationId": None, "elapsedMs": None}),
            dcc.Store(id="of-debug-store", data={"open": False}),

            # Large payload UX: keep paging state outside the aggregator payload.
            dcc.Store(id="of-deliverables-store", data={"items": [], "cursor": "", "nextCursor": "", "total": 0, "type": "", "cursorStack": []}),
            dcc.Store(id="of-resources-store", data={"items": [], "cursor": "", "nextCursor": "", "total": 0, "cursorStack": []}),

            # Lazy body load (brief)
            dcc.Store(id="of-brief-full", data={"state": "idle", "body": None, "deliverableId": None}),

            html.Div(id="of-auth-gate"),
            html.Div(
                id="of-workspace-shell",
                children=[
                    _section_header(
                        "Offer Factory",
                        right=[
                            html.Button("Inspector", id="of-debug-toggle", className="of-btn"),
                            html.Button("Retry Load", id="of-retry-workspace", className="of-btn of-btn--primary"),
                        ],
                    ),
                    html.Div(id="of-workspace-body"),
                    html.Div(id="of-debug-drawer"),
                ],
            ),
        ],
    )


app.layout = html.Div(className="of-shell", children=[_rail_layout(), _main_layout()])


# ------------------------------
# Offer list loading
# ------------------------------
@app.callback(
    Output("of-offers-store", "data"),
    Output("of-auth-store", "data"),
    Input("of-offer-search", "n_clicks"),
    Input("of-offer-clear", "n_clicks"),
    Input("of-offers-next", "n_clicks"),
    Input("of-offers-prev", "n_clicks"),
    State("of-offer-query", "value"),
    State("of-offer-status", "value"),
    State("of-offers-store", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=False,
)
def load_offers(_search, _clear, _next, _prev, query, status_value, offers_store, auth_store):
    auth_locked = bool((auth_store or {}).get("locked"))

    triggered = (callback_context.triggered[0]["prop_id"] if callback_context.triggered else "")

    next_query = (query or "").strip()
    status_value = (status_value or "").strip()
    cursor = ""

    if triggered.startswith("of-offer-clear"):
        next_query = ""
        cursor = ""
    elif triggered.startswith("of-offers-next"):
        cursor = (offers_store or {}).get("nextCursor") or ""
    elif triggered.startswith("of-offers-prev"):
        # For a real backend, prev cursor should be provided; in mock we just restart.
        cursor = ""

    cid = str(uuid.uuid4())
    result, next_locked = api_client.list_offers(
        query=next_query,
        cursor=cursor,
        status=status_value,
        correlation_id=cid,
        auth_locked=auth_locked,
    )

    next_auth_store = {"locked": next_locked, "last401": result.correlation_id if next_locked else None}

    if not result.ok:
        # Keep existing store; just update auth state.
        return no_update, next_auth_store

    payload = result.data or {}
    return (
        {
            "items": payload.get("items", []),
            "cursor": cursor,
            "nextCursor": payload.get("nextCursor", ""),
            "total": payload.get("total", 0),
            "query": next_query,
            "status": status_value,
        },
        next_auth_store,
    )


@app.callback(
    Output("of-offer-list", "children"),
    Output("of-offers-pageinfo", "children"),
    Input("of-offers-store", "data"),
    State("of-selected-offer", "data"),
)
def render_offer_list(offers_store, selected_offer):
    items = (offers_store or {}).get("items") or []
    total = (offers_store or {}).get("total") or 0
    next_cursor = (offers_store or {}).get("nextCursor") or ""

    selected_id = (selected_offer or {}).get("offerId")

    cards = []
    for o in items:
        oid = o.get("offerId")
        cls = "of-offer-item" + (" is-active" if oid and oid == selected_id else "")
        cards.append(
            html.Div(
                id={"type": "of-offer-item", "offerId": oid},
                className=cls,
                children=[
                    html.Div(o.get("offerName") or "(Unnamed)", className="of-offer-name"),
                    html.Div(
                        f"{o.get('status','')} • {o.get('offerId','')}",
                        className="of-offer-meta",
                    ),
                ],
            )
        )
        cards.append(html.Div(style={"height": "10px"}))

    info = f"{len(items)} shown • total {total}" + (" • more" if next_cursor else "")
    return html.Div(children=cards), info


# Click offer selection via pattern-matching callback
@app.callback(
    Output("of-selected-offer", "data"),
    Input({"type": "of-offer-item", "offerId": dash.ALL}, "n_clicks"),
    State({"type": "of-offer-item", "offerId": dash.ALL}, "id"),
    prevent_initial_call=True,
)
def select_offer(_clicks, ids):
    if not callback_context.triggered:
        return no_update
    trg = callback_context.triggered[0]["prop_id"]
    # prop_id format: {"type":"of-offer-item","offerId":"..."}.n_clicks
    try:
        id_json = trg.split(".")[0]
        id_obj = json.loads(id_json)
        return {"offerId": id_obj.get("offerId")}
    except Exception:
        return no_update


# ------------------------------
# Workspace load (single call)
# ------------------------------
@app.callback(
    Output("of-workspace-store", "data"),
    Output("of-auth-store", "data"),
    Input("of-selected-offer", "data"),
    Input("of-retry-workspace", "n_clicks"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def load_workspace(selected_offer, _retry, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return {"state": "empty", "payload": None, "correlationId": None, "elapsedMs": None}, auth_store

    # Retry button resets auth lock explicitly.
    triggered = (callback_context.triggered[0]["prop_id"] if callback_context.triggered else "")
    auth_locked = bool((auth_store or {}).get("locked"))
    if triggered.startswith("of-retry-workspace"):
        auth_locked = False

    cid = str(uuid.uuid4())
    result, next_locked = api_client.get_workspace_offer(offer_id, correlation_id=cid, auth_locked=auth_locked)

    next_auth_store = {"locked": next_locked, "last401": result.correlation_id if next_locked else None}

    if not result.ok:
        return (
            {
                "state": "error",
                "payload": {"status": result.status, "error": result.error},
                "correlationId": result.correlation_id,
                "elapsedMs": result.elapsed_ms,
            },
            next_auth_store,
        )

    return (
        {
            "state": "ok",
            "payload": result.data,
            "correlationId": result.correlation_id,
            "elapsedMs": result.elapsed_ms,
        },
        next_auth_store,
    )


# ------------------------------
# Auth gate rendering
# ------------------------------
@app.callback(
    Output("of-auth-gate", "children"),
    Output("of-workspace-shell", "style"),
    Input("of-auth-store", "data"),
)
def render_auth_gate(auth_store):
    locked = bool((auth_store or {}).get("locked"))
    if not locked:
        return "", {"display": "block"}

    return (
        html.Div(
            className="of-card",
            children=[
                html.H3("Authentication required", style={"margin": "0 0 8px 0"}),
                html.Div(
                    "The API returned 401. The workspace is locked to prevent request storms. "
                    "Log in, then click Retry Load.",
                    style={"color": "var(--gray-700)"},
                ),
                html.Div(style={"height": "12px"}),
                _pill("AUTH LOCKED", kind="err"),
            ],
        ),
        {"display": "none"},
    )


# ------------------------------
# Main workspace UI
# ------------------------------
@app.callback(
    Output("of-workspace-body", "children"),
    Input("of-workspace-store", "data"),
)
def render_workspace(workspace_store):
    state = (workspace_store or {}).get("state")

    if state in (None, "empty"):
        return html.Div(className="of-card", children=["Select an offer to begin."])

    if state == "error":
        payload = (workspace_store or {}).get("payload") or {}
        return _error_card(
            "Workspace failed to load",
            f"Status: {payload.get('status')} • {payload.get('error')}",
            retry_id="of-retry-workspace",
        )

    payload = (workspace_store or {}).get("payload") or {}

    offer = payload.get("offer") or {}
    integrity = payload.get("integrity") or {}
    warnings = integrity.get("warnings") or []

    header = html.Div(
        className="of-card",
        children=[
            html.Div(className="of-row", children=[
                html.Div(style={"fontSize": "20px", "fontWeight": 900}, children=offer.get("offerName") or "(Unnamed offer)"),
                _pill(f"{offer.get('status','')}", kind="ok" if offer.get("status") == "active" else ""),
                _pill(f"Deliverables: {integrity.get('counts',{}).get('deliverablesLinked',0)}"),
                _pill(f"Resources: {integrity.get('counts',{}).get('resourcesLinked',0)}"),
                _pill(f"Warnings: {len(warnings)}", kind="warn" if warnings else "ok"),
            ]),
            html.Div(style={"height": "10px"}),
            html.Div(style={"color": "var(--gray-600)", "fontSize": "12px"}, children=f"OfferId: {offer.get('offerId')}"),
        ],
    )

    tabs = dcc.Tabs(
        id="of-tabs",
        value="overview",
        className="of-tabs",
        children=[
            dcc.Tab(label="Overview", value="overview", className="tab", selected_className="tab tab--selected"),
            dcc.Tab(label="Frameworks", value="frameworks", className="tab", selected_className="tab tab--selected"),
            dcc.Tab(label="Offer Brief", value="brief", className="tab", selected_className="tab tab--selected"),
            dcc.Tab(label="Deliverables", value="deliverables", className="tab", selected_className="tab tab--selected"),
            dcc.Tab(label="Resources", value="resources", className="tab", selected_className="tab tab--selected"),
            dcc.Tab(label="Integrity & Repair", value="repair", className="tab", selected_className="tab tab--selected"),
        ],
    )

    return html.Div([header, html.Div(style={"height": "12px"}), tabs, html.Div(id="of-tab-body")])


@app.callback(
    Output("of-deliverables-store", "data"),
    Output("of-resources-store", "data"),
    Output("of-brief-full", "data"),
    Input("of-workspace-store", "data"),
)
def seed_paging_stores(workspace_store):
    if (workspace_store or {}).get("state") != "ok":
        return no_update, no_update, {"state": "idle", "body": None, "deliverableId": None}

    payload = (workspace_store or {}).get("payload") or {}
    deliverables = payload.get("deliverables") or {}
    resources = payload.get("resources") or {}

    return (
        {
            "items": deliverables.get("items", []),
            "cursor": "",
            "nextCursor": deliverables.get("nextCursor", ""),
            "total": deliverables.get("total", 0),
            "type": "",
            "cursorStack": [],
        },
        {
            "items": resources.get("items", []),
            "cursor": "",
            "nextCursor": resources.get("nextCursor", ""),
            "total": resources.get("total", 0),
            "cursorStack": [],
        },
        {"state": "idle", "body": None, "deliverableId": None},
    )


@app.callback(
    Output("of-tab-body", "children"),
    Input("of-tabs", "value"),
    State("of-workspace-store", "data"),
)
def render_tab_body(tab, workspace_store):
    payload = (workspace_store or {}).get("payload") or {}
    offer = payload.get("offer") or {}
    errors = payload.get("errors") or []

    def section_error(section_name: str) -> Optional[html.Div]:
        match = [e for e in errors if (e or {}).get("section") == section_name]
        if not match:
            return None
        e = match[0] or {}
        return _error_card(
            f"{section_name.capitalize()} failed to load",
            f"{e.get('code','ERROR')}: {e.get('message','')}",
            retry_id="of-retry-workspace" if e.get("retryable", True) else None,
        )

    if tab == "overview":
        snapshot = offer.get("snapshot") or {}
        return html.Div(
            className="of-card",
            children=[
                html.H3("Snapshot", style={"margin": "0 0 8px 0"}),
                html.Div(f"SnapshotId: {snapshot.get('snapshotId')}", style={"color": "var(--gray-700)"}),
                html.Div(snapshot.get("summary") or "(no summary)", style={"color": "var(--gray-700)", "marginTop": "8px"}),
            ],
        )

    if tab == "frameworks":
        err = section_error("frameworks")
        if err:
            return err
        fw = payload.get("frameworks") or {}
        items = fw.get("items") or []
        btns = [html.Button("Regenerate", id="of-fw-generate", className="of-btn of-btn--primary")]
        cards = []
        for f in items:
            cards.append(
                html.Div(
                    className="of-card",
                    children=[
                        html.Div(className="of-row", children=[
                            html.Div(f.get("title") or "Framework", style={"fontWeight": 900}),
                            _pill(f"from {f.get('generatedFromSnapshotId','')[:12]}")
                        ]),
                        html.Div(style={"height": "8px"}),
                        html.Div(f.get("bodyPreview") or "", style={"color": "var(--gray-700)"}),
                        html.Div(style={"height": "8px"}),
                        html.Div(style={"color": "var(--gray-600)", "fontSize": "12px"}, children=f"Updated: {f.get('updatedAt','')}")
                    ],
                )
            )
        return html.Div([html.Div(className="of-row", children=btns), html.Div(style={"height": "12px"}), *cards])

    if tab == "brief":
        err = section_error("brief")
        if err:
            return err
        brief = payload.get("brief")
        if not brief:
            return _error_card(
                "No current brief",
                "This offer does not have a current brief set (currentBriefDeliverableId missing or broken). Use Integrity & Repair to set one.",
            )
        return html.Div(
            className="of-card",
            children=[
                html.Div(className="of-row", children=[
                    html.Div(brief.get("title") or "Offer Brief", style={"fontWeight": 900}),
                    _pill(brief.get("status") or ""),
                    html.Button("Open Full", id="of-brief-open-full", className="of-btn"),
                    html.Button("Publish/Replace", id="of-brief-publish", className="of-btn of-btn--primary"),
                ]),
                html.Div(style={"height": "10px"}),
                html.Div(brief.get("bodyPreview") or "", style={"color": "var(--gray-700)"}),
                html.Div(style={"height": "10px"}),
                html.Div(id="of-brief-full-body"),
                html.Div(style={"height": "10px"}),
                dcc.Textarea(
                    id="of-brief-body",
                    value="",
                    placeholder="Optional: paste a new brief body to publish/replace",
                    style={"width": "100%", "minHeight": "140px", "border": "1px solid var(--border-default)", "borderRadius": "8px", "padding": "12px"},
                ),
            ],
        )

    if tab == "deliverables":
        err = section_error("deliverables")
        if err:
            return err

        return html.Div(
            children=[
                html.Div(className="of-card", children=[
                    html.Div(className="of-row", children=[
                        html.Div("Deliverables", style={"fontWeight": 900, "fontSize": "16px"}),
                        dcc.Dropdown(
                            id="of-deliverables-type",
                            options=[
                                {"label": "All", "value": ""},
                                {"label": "Deliverable", "value": "deliverable"},
                                {"label": "Offer Brief", "value": "offer_brief"},
                            ],
                            value="",
                            clearable=False,
                            style={"minWidth": "220px"},
                        ),
                        html.Button("Prev", id="of-deliverables-prev", className="of-btn"),
                        html.Button("Next", id="of-deliverables-next", className="of-btn"),
                        html.Span(id="of-deliverables-info", style={"color": "var(--gray-600)", "fontSize": "12px"}),
                    ]),
                ]),
                html.Div(style={"height": "12px"}),
                html.Div(id="of-deliverables-table"),
            ]
        )
        table = dash_table.DataTable(
            data=rows,
            columns=[
                {"name": "Type", "id": "type"},
                {"name": "Status", "id": "status"},
                {"name": "Title", "id": "title"},
                {"name": "Updated", "id": "updatedAt"},
                {"name": "ID", "id": "deliverableId"},
            ],
            page_action="none",
            style_table={"overflowX": "auto"},
            style_cell={"fontFamily": "inherit", "fontSize": "12px", "padding": "8px", "whiteSpace": "normal"},
            style_header={"fontWeight": "900", "backgroundColor": "var(--gray-50)", "border": "1px solid var(--border-default)"},
            style_data={"border": "1px solid var(--border-default)"},
        )
        return html.Div(
            className="of-card",
            children=[
                html.Div(className="of-row", children=[
                    _pill(f"Total: {d.get('total',0)}"),
                    _pill("Page size: 25"),
                    html.Div(style={"color": "var(--gray-600)", "fontSize": "12px"}, children="Pagination for 1,000+ items uses /api/deliverables?cursor=..."),
                ]),
                html.Div(style={"height": "12px"}),
                table,
            ],
        )

    if tab == "resources":
        err = section_error("resources")
        if err:
            return err
        return html.Div(
            children=[
                html.Div(className="of-card", children=[
                    html.Div(className="of-row", children=[
                        html.Div("Resources / Creatives", style={"fontWeight": 900, "fontSize": "16px"}),
                        dcc.Input(id="of-resource-id", className="of-input", placeholder="Attach by resourceId", value="", style={"maxWidth": "320px"}),
                        html.Button("Attach", id="of-resource-attach", className="of-btn of-btn--primary"),
                        html.Button("Prev", id="of-resources-prev", className="of-btn"),
                        html.Button("Next", id="of-resources-next", className="of-btn"),
                        html.Span(id="of-resources-info", style={"color": "var(--gray-600)", "fontSize": "12px"}),
                    ]),
                ]),
                html.Div(style={"height": "12px"}),
                html.Div(id="of-resources-grid"),
            ]
        )

    if tab == "repair":
        integrity = payload.get("integrity") or {}
        warnings = integrity.get("warnings") or []
        repair = (integrity.get("repair") or {}).get("unlinkedDeliverables") or {}
        unlinked = repair.get("items") or []

        warn_cards = []
        for w in warnings:
            sev = w.get("severity")
            kind = "warn" if sev == "warning" else "err" if sev == "error" else ""
            warn_cards.append(
                html.Div(
                    className="of-card",
                    children=[
                        html.Div(className="of-row", children=[
                            _pill(w.get("code") or "WARNING", kind=kind),
                            html.Div(w.get("message") or "", style={"fontWeight": 900}),
                        ]),
                        html.Div(style={"height": "8px"}),
                        html.Div(json.dumps(w.get("details") or {}, indent=2), className="of-pre"),
                    ],
                )
            )

        unlinked_table = dash_table.DataTable(
            id="of-unlinked-deliverables",
            data=unlinked,
            columns=[
                {"name": "Title", "id": "title"},
                {"name": "Type", "id": "type"},
                {"name": "Status", "id": "status"},
                {"name": "Suggested Offer", "id": "suggestedOfferId"},
                {"name": "ID", "id": "deliverableId"},
            ],
            row_selectable="single",
            style_table={"overflowX": "auto"},
            style_cell={"fontFamily": "inherit", "fontSize": "12px", "padding": "8px", "whiteSpace": "normal"},
            style_header={"fontWeight": "900", "backgroundColor": "var(--gray-50)", "border": "1px solid var(--border-default)"},
            style_data={"border": "1px solid var(--border-default)"},
        )

        return html.Div(
            children=[
                html.Div(className="of-card", children=[
                    html.H3("Integrity Warnings", style={"margin": "0 0 8px 0"}),
                    html.Div("These are surfaced instead of silently dropping data.", style={"color": "var(--gray-700)"}),
                ]),
                html.Div(style={"height": "12px"}),
                *warn_cards,
                html.Div(style={"height": "12px"}),
                html.Div(className="of-card", children=[
                    html.H3("Repair: Unlinked Deliverables", style={"margin": "0 0 8px 0"}),
                    html.Div("Select a row and relink it to the currently selected offer.", style={"color": "var(--gray-700)"}),
                    html.Div(style={"height": "12px"}),
                    unlinked_table,
                    html.Div(style={"height": "12px"}),
                    html.Div(className="of-row", children=[
                        html.Button("Relink to this Offer", id="of-repair-relink", className="of-btn of-btn--primary"),
                        html.Button("Set as Current Brief", id="of-repair-set-brief", className="of-btn"),
                    ]),
                ]),
            ]
        )

    return html.Div(className="of-card", children=["Unknown tab"])


# ------------------------------
# Actions (framework regen, brief publish/replace, repair)
# ------------------------------
@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input("of-fw-generate", "n_clicks"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_generate_frameworks(_n, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return no_update, auth_store

    cid = str(uuid.uuid4())
    result, locked = api_client.generate_frameworks(offer_id, correlation_id=cid, auth_locked=bool((auth_store or {}).get("locked")))
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    # Reload workspace to reflect changes.
    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth

    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input("of-brief-publish", "n_clicks"),
    State("of-selected-offer", "data"),
    State("of-brief-body", "value"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_publish_brief(_n, selected_offer, brief_body, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return no_update, auth_store

    body = (brief_body or "").strip() or None
    cid = str(uuid.uuid4())
    result, locked = api_client.publish_or_replace_brief(offer_id, body=body, correlation_id=cid, auth_locked=bool((auth_store or {}).get("locked")))
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth

    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input("of-repair-relink", "n_clicks"),
    State("of-unlinked-deliverables", "derived_virtual_selected_rows"),
    State("of-unlinked-deliverables", "data"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_repair_relink(_n, selected_rows, table_data, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return no_update, auth_store

    if not selected_rows:
        return no_update, auth_store

    idx = selected_rows[0]
    if idx is None or idx >= len(table_data or []):
        return no_update, auth_store

    deliverable_id = (table_data[idx] or {}).get("deliverableId")
    if not deliverable_id:
        return no_update, auth_store

    cid = str(uuid.uuid4())
    result, locked = api_client.relink_deliverable(offer_id, deliverable_id, correlation_id=cid, auth_locked=bool((auth_store or {}).get("locked")))
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth

    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input("of-repair-set-brief", "n_clicks"),
    State("of-unlinked-deliverables", "derived_virtual_selected_rows"),
    State("of-unlinked-deliverables", "data"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_set_current_brief(_n, selected_rows, table_data, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id or not selected_rows:
        return no_update, auth_store

    idx = selected_rows[0]
    deliverable_id = (table_data[idx] or {}).get("deliverableId") if table_data and idx < len(table_data) else None
    if not deliverable_id:
        return no_update, auth_store

    cid = str(uuid.uuid4())
    result, locked = api_client.publish_or_replace_brief(
        offer_id,
        deliverable_id=deliverable_id,
        correlation_id=cid,
        auth_locked=bool((auth_store or {}).get("locked")),
    )
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth

    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


@app.callback(
    Output("of-brief-full", "data"),
    Input("of-brief-open-full", "n_clicks"),
    State("of-workspace-store", "data"),
    State("of-brief-full", "data"),
    prevent_initial_call=True,
)
def load_full_brief(_n, workspace_store, brief_full_store):
    payload = (workspace_store or {}).get("payload") or {}
    brief = payload.get("brief") or {}
    deliverable_id = brief.get("deliverableId") or brief.get("Deliverable_ID") or brief.get("deliverable_id")
    if not deliverable_id:
        return {"state": "idle", "body": None, "deliverableId": None}

    # Dedup: if already loaded for this deliverable, keep.
    if (brief_full_store or {}).get("deliverableId") == deliverable_id and (brief_full_store or {}).get("state") == "ok":
        return no_update

    # Lazy load is a secondary call allowed by spec.
    # Note: uses raw GET deliverable endpoint in mock; production can have a slim body endpoint.
    # This call is intentionally not part of workspace hydration.
    try:
        import requests

        base = os.getenv("OFFER_FACTORY_API_BASE", "").strip().rstrip("/") or os.getenv(
            "OFFER_FACTORY_SELF_BASE", "http://127.0.0.1:8050"
        ).strip().rstrip("/")
        resp = requests.get(
            f"{base}/api/deliverables/{deliverable_id}",
            headers={"Accept": "application/json", "X-Correlation-Id": str(uuid.uuid4())},
            timeout=15,
        )
        if resp.status_code == 401:
            return {"state": "error", "body": "UNAUTHORIZED", "deliverableId": deliverable_id}
        if not (200 <= resp.status_code < 300):
            return {"state": "error", "body": resp.text[:500], "deliverableId": deliverable_id}
        d = resp.json() if resp.text else {}

        def pick_body(payload: dict) -> str:
            if not isinstance(payload, dict):
                return ""
            # Mock backend shape
            if payload.get("body"):
                return payload.get("body")
            # New Next endpoint shape: { ok, deliverable: { body } }
            deliverable = payload.get("deliverable") or {}
            if isinstance(deliverable, dict):
                if deliverable.get("body"):
                    return deliverable.get("body")
                if deliverable.get("Description"):
                    return deliverable.get("Description")
                md = deliverable.get("metadata") or deliverable.get("Metadata") or {}
                if isinstance(md, dict) and md.get("description"):
                    return md.get("description")
            # Fallbacks
            if payload.get("Description"):
                return payload.get("Description")
            md2 = payload.get("metadata") or payload.get("Metadata") or {}
            if isinstance(md2, dict) and md2.get("description"):
                return md2.get("description")
            return ""

        body = pick_body(d)
        return {"state": "ok", "body": body, "deliverableId": str(deliverable_id)}
    except Exception as e:
        return {"state": "error", "body": str(e), "deliverableId": deliverable_id}


@app.callback(
    Output("of-brief-full-body", "children"),
    Input("of-brief-full", "data"),
)
def render_full_brief(brief_full):
    state = (brief_full or {}).get("state")
    if state in (None, "idle"):
        return ""
    if state == "error":
        return html.Div(
            style={"marginTop": "10px"},
            children=[_pill("FULL BODY LOAD FAILED", kind="err"), html.Div((brief_full or {}).get("body") or "")],
        )
    body = (brief_full or {}).get("body") or ""
    return html.Div(
        style={"marginTop": "10px"},
        children=[
            html.Div(className="of-row", children=[_pill("FULL BODY", kind="ok"), html.Div("(lazy loaded)", style={"color": "var(--gray-600)", "fontSize": "12px"})]),
            html.Div(style={"height": "8px"}),
            html.Div(body, className="of-pre"),
        ],
    )


@app.callback(
    Output("of-deliverables-store", "data"),
    Output("of-auth-store", "data"),
    Input("of-deliverables-next", "n_clicks"),
    Input("of-deliverables-prev", "n_clicks"),
    Input("of-deliverables-type", "value"),
    State("of-deliverables-store", "data"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def page_deliverables(_next, _prev, type_value, del_store, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return no_update, auth_store

    del_store = del_store or {"items": [], "cursor": "", "nextCursor": "", "total": 0, "type": "", "cursorStack": []}
    cursor_stack = list(del_store.get("cursorStack") or [])
    cursor = del_store.get("cursor") or ""
    next_cursor = del_store.get("nextCursor") or ""
    cur_type = del_store.get("type") or ""

    trig = (callback_context.triggered[0]["prop_id"] if callback_context.triggered else "")

    # Type change resets pagination.
    if trig.startswith("of-deliverables-type"):
        cursor_stack = []
        cursor = ""
        next_cursor = ""
        cur_type = type_value or ""
    elif trig.startswith("of-deliverables-next"):
        if not next_cursor:
            return no_update, auth_store
        cursor_stack.append(cursor)
        cursor = next_cursor
    elif trig.startswith("of-deliverables-prev"):
        if not cursor_stack:
            return no_update, auth_store
        cursor = cursor_stack.pop()

    cid = str(uuid.uuid4())
    result, locked = api_client.get_deliverables_page(
        offer_id=offer_id,
        type_filter=cur_type,
        cursor=cursor,
        correlation_id=cid,
        auth_locked=bool((auth_store or {}).get("locked")),
    )
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    payload = result.data or {}
    return (
        {
            "items": payload.get("items", []),
            "cursor": cursor,
            "nextCursor": payload.get("nextCursor", ""),
            "total": payload.get("total", 0),
            "type": cur_type,
            "cursorStack": cursor_stack,
        },
        next_auth,
    )


@app.callback(
    Output("of-deliverables-table", "children"),
    Output("of-deliverables-info", "children"),
    Input("of-deliverables-store", "data"),
)
def render_deliverables_table(del_store):
    del_store = del_store or {}
    rows = del_store.get("items") or []
    total = del_store.get("total") or 0
    t = del_store.get("type") or ""
    next_cursor = del_store.get("nextCursor") or ""
    cursor = del_store.get("cursor") or ""
    info = f"{len(rows)} shown • total {total}" + (" • more" if next_cursor else "")
    if t:
        info += f" • type={t}"
    if cursor:
        info += " • paged"

    table = dash_table.DataTable(
        data=rows,
        columns=[
            {"name": "Type", "id": "type"},
            {"name": "Status", "id": "status"},
            {"name": "Title", "id": "title"},
            {"name": "Updated", "id": "updatedAt"},
            {"name": "ID", "id": "deliverableId"},
        ],
        page_action="none",
        style_table={"overflowX": "auto"},
        style_cell={"fontFamily": "inherit", "fontSize": "12px", "padding": "8px", "whiteSpace": "normal"},
        style_header={"fontWeight": "900", "backgroundColor": "var(--gray-50)", "border": "1px solid var(--border-default)"},
        style_data={"border": "1px solid var(--border-default)"},
    )

    return html.Div(className="of-card", children=[table]), info


# Resources paging + attach/detach: implemented as secondary calls (allowed).
@app.callback(
    Output("of-resources-store", "data"),
    Output("of-auth-store", "data"),
    Input("of-resources-next", "n_clicks"),
    Input("of-resources-prev", "n_clicks"),
    State("of-resources-store", "data"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def page_resources(_next, _prev, res_store, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id:
        return no_update, auth_store

    res_store = res_store or {"items": [], "cursor": "", "nextCursor": "", "total": 0, "cursorStack": []}
    cursor_stack = list(res_store.get("cursorStack") or [])
    cursor = res_store.get("cursor") or ""
    next_cursor = res_store.get("nextCursor") or ""

    trig = (callback_context.triggered[0]["prop_id"] if callback_context.triggered else "")
    if trig.startswith("of-resources-next"):
        if not next_cursor:
            return no_update, auth_store
        cursor_stack.append(cursor)
        cursor = next_cursor
    elif trig.startswith("of-resources-prev"):
        if not cursor_stack:
            return no_update, auth_store
        cursor = cursor_stack.pop()

    cid = str(uuid.uuid4())
    result, locked = api_client.get_resources_page(
        offer_id=offer_id,
        cursor=cursor,
        correlation_id=cid,
        auth_locked=bool((auth_store or {}).get("locked")),
    )
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    payload = result.data or {}
    return (
        {
            "items": payload.get("items", []),
            "cursor": cursor,
            "nextCursor": payload.get("nextCursor", ""),
            "total": payload.get("total", 0),
            "cursorStack": cursor_stack,
        },
        next_auth,
    )


@app.callback(
    Output("of-resources-grid", "children"),
    Output("of-resources-info", "children"),
    Input("of-resources-store", "data"),
)
def render_resources_grid(res_store):
    res_store = res_store or {}
    items = res_store.get("items") or []
    total = res_store.get("total") or 0
    next_cursor = res_store.get("nextCursor") or ""
    info = f"{len(items)} shown • total {total}" + (" • more" if next_cursor else "")

    cards = []
    for item in items:
        img = html.Img(
            src=item.get("thumbUrl"),
            style={"width": "100%", "height": "160px", "objectFit": "cover", "borderRadius": "8px", "border": "1px solid var(--border-default)"},
            loading="lazy",
        )
        cards.append(
            html.Div(
                className="of-card",
                children=[
                    img,
                    html.Div(style={"height": "10px"}),
                    html.Div(item.get("filename") or "", style={"fontWeight": 900, "fontSize": "13px"}),
                    html.Div(", ".join(item.get("tags") or []), style={"color": "var(--gray-600)", "fontSize": "12px"}),
                    html.Div(style={"height": "10px"}),
                    html.Div(className="of-row", children=[
                        html.Div(style={"color": "var(--gray-600)", "fontSize": "12px"}, children=item.get("resourceId")),
                        html.Button("Detach", id={"type": "of-resource-detach", "resourceId": item.get("resourceId")}, className="of-btn"),
                    ]),
                ],
            )
        )

    return html.Div(className="of-grid", children=cards), info


@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input("of-resource-attach", "n_clicks"),
    State("of-resource-id", "value"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_attach_resource(_n, resource_id, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    resource_id = (resource_id or "").strip()
    if not offer_id or not resource_id:
        return no_update, auth_store

    cid = str(uuid.uuid4())
    result, locked = api_client.attach_resource(offer_id, resource_id, correlation_id=cid, auth_locked=bool((auth_store or {}).get("locked")))
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth
    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


@app.callback(
    Output("of-workspace-store", "data", allow_duplicate=True),
    Output("of-auth-store", "data", allow_duplicate=True),
    Input({"type": "of-resource-detach", "resourceId": dash.ALL}, "n_clicks"),
    State({"type": "of-resource-detach", "resourceId": dash.ALL}, "id"),
    State("of-selected-offer", "data"),
    State("of-auth-store", "data"),
    prevent_initial_call=True,
)
def on_detach_resource(_clicks, ids, selected_offer, auth_store):
    offer_id = (selected_offer or {}).get("offerId")
    if not offer_id or not callback_context.triggered:
        return no_update, auth_store

    trg = callback_context.triggered[0]["prop_id"]
    try:
        id_json = trg.split(".")[0]
        id_obj = json.loads(id_json)
        resource_id = id_obj.get("resourceId")
    except Exception:
        resource_id = None

    if not resource_id:
        return no_update, auth_store

    cid = str(uuid.uuid4())
    result, locked = api_client.detach_resource(offer_id, resource_id, correlation_id=cid, auth_locked=bool((auth_store or {}).get("locked")))
    next_auth = {"locked": locked, "last401": result.correlation_id if locked else None}
    if not result.ok:
        return no_update, next_auth

    ws, locked2 = api_client.get_workspace_offer(offer_id, correlation_id=str(uuid.uuid4()), auth_locked=locked)
    next_auth = {"locked": locked2, "last401": ws.correlation_id if locked2 else None}
    if not ws.ok:
        return no_update, next_auth
    return {"state": "ok", "payload": ws.data, "correlationId": ws.correlation_id, "elapsedMs": ws.elapsed_ms}, next_auth


# ------------------------------
# Inspector (debug drawer)
# ------------------------------
@app.callback(
    Output("of-debug-store", "data"),
    Input("of-debug-toggle", "n_clicks"),
    State("of-debug-store", "data"),
    prevent_initial_call=True,
)
def toggle_debug(_n, dbg):
    is_open = bool((dbg or {}).get("open"))
    return {"open": not is_open}


@app.callback(
    Output("of-debug-drawer", "children"),
    Input("of-debug-store", "data"),
    State("of-workspace-store", "data"),
)
def render_debug_drawer(dbg, workspace_store):
    if not bool((dbg or {}).get("open")):
        return ""

    payload = (workspace_store or {}).get("payload")
    cid = (workspace_store or {}).get("correlationId")
    elapsed = (workspace_store or {}).get("elapsedMs")
    debug = _safe_get(payload or {}, "debug", default={})
    timings = debug.get("timingsMs") or {}

    return html.Div(
        className="of-debug-drawer",
        children=[
            html.Div(
                className="of-card",
                children=[
                    html.Div(className="of-row", children=[
                        html.Div("Workspace Inspector", style={"fontWeight": 900, "fontSize": "16px"}),
                        _pill(f"CID: {cid or '-'}"),
                        _pill(f"Client ms: {elapsed or 0}"),
                        _pill(f"Server total ms: {timings.get('total',0)}"),
                    ]),
                    html.Div(style={"height": "10px"}),
                    html.Div("Timings (ms)", style={"fontWeight": 900}),
                    html.Div(json.dumps(timings, indent=2), className="of-pre"),
                    html.Div(style={"height": "10px"}),
                    html.Div("Raw payload", style={"fontWeight": 900}),
                    html.Div(json.dumps(payload, indent=2), className="of-pre"),
                ],
            )
        ],
    )


if __name__ == "__main__":
    # NOTE: In production behind a real backend, set OFFER_FACTORY_API_BASE.
    app.run(debug=True, host="127.0.0.1", port=8050)
