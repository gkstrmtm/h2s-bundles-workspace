# Offer Factory (Python Dash)

Production-grade Offer workspace UI built in **Python Dash** using a single **workspace aggregator** contract.

## Run (Windows PowerShell)

```powershell
cd .\offer_factory_dash
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Then open: `http://127.0.0.1:8050`

## API Mode

By default, the app serves a **mock backend** on the same server under `/api/*`.

To point at a real backend, set:

- `OFFER_FACTORY_API_BASE` (example: `https://your-domain.com`)

If you run the Dash server on a non-default host/port in mock mode, set:

- `OFFER_FACTORY_SELF_BASE` (example: `http://127.0.0.1:8050`)

The UI will call:
- `GET {API_BASE}/api/offers?query=&cursor=`
- `GET {API_BASE}/api/workspace/offers/{offerId}`

## What’s in here

- `app.py` — Dash UI (split view, tabs, pagination, inspector, repair)
- `api_client.py` — centralized request wrapper (correlation IDs, auth-lock, retries)
- `mock_backend.py` — mock endpoints implementing the contract + integrity/repair flows
- `docs/contracts.md` — backend contract shapes + endpoint list
- `docs/integrity_and_migration.md` — deterministic linking rules + migration/repair plan

## Quick validation scenarios

See `docs/testing_path.md`.
