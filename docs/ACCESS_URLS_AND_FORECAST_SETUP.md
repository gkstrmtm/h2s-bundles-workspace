# Home2Smart access URLs and Forecast connections

Reviewed 2026-11-05. These are entry URLs, not permission grants. Management, salesperson and technician sessions remain separate role-controlled experiences.

## Real application entry points

| Who / purpose | URL | Notes |
|---|---|---|
| Management dashboard | https://portal.home2smart.com/dash | Sign in with an authorized management account. |
| Strategy & Forecasting | https://portal.home2smart.com/dash?tab=strategy | ADMIN only; part of the dashboard, not a separate public app. |
| Operations | https://portal.home2smart.com/dash?tab=operations | Dispatch, Scheduling and Reconciliation are contextual views inside Operations. |
| Management Field Sales | https://portal.home2smart.com/dash?tab=fieldsales | Management oversight, not the representative app. |
| Admin Dashboard | https://portal.home2smart.com/dash?tab=admin | Existing administrative tools. |
| Customer Queue | https://portal.home2smart.com/dash?tab=commercialqueue | Management customer inquiries. |
| Website Media | https://portal.home2smart.com/dash?tab=proofpacks | Existing management media tools. |
| Sales representatives | https://portal.home2smart.com/sales.html | Dedicated SALES-role app. Do not send representatives to the management dashboard. |
| Technician portal | https://portal.home2smart.com/portal | Technician jobs, offers and existing technician workflows. This is not the salesperson app. |
| Internal link hub | https://portal.home2smart.com/hub | Existing directory; not an authorization substitute. |
| Residential customers | https://shop.home2smart.com/residential | Customer service/inquiry entry. |
| Commercial customers | https://shop.home2smart.com/commercial | Commercial customer inquiry entry. |
| Existing bundle checkout | https://shop.home2smart.com/bundles | Separate existing checkout; proposed catalogs do not become approved offers here. |
| Customer installation setup | https://shop.home2smart.com/schedule-setup | Existing customer scheduling/setup flow; eligibility still applies. |
| Gallery | https://shop.home2smart.com/gallery | Customer-facing examples. |
| Reviews | https://shop.home2smart.com/reviews | Existing customer reviews page. |
| Owner uploads | https://portal.home2smart.com/media | Existing finite-link upload authorization is still required where applicable. |
| Deliverables library | https://portal.home2smart.com/deliverables | Existing internal library surface and its authorization. |
| Historical internal library | https://portal.home2smart.com/library | Existing archive, distinct from current job management. |
| Funnel reporting | https://portal.home2smart.com/funnel-track | Existing analytics surface. |

Dashboard `tab` links are supported by the shell after session restoration; the shell removes the query after routing. If signing in lands on the default destination, reopen the link after sign-in or use the named sidebar destination. No direct production URL for a particular Operations subview is claimed.

### Representative destinations

- Home: https://portal.home2smart.com/sales.html?view=home
- Leads: https://portal.home2smart.com/sales.html?view=leads
- Quotes: https://portal.home2smart.com/sales.html?view=quotes
- Orders: https://portal.home2smart.com/sales.html?view=orders
- Earnings: https://portal.home2smart.com/sales.html?view=earnings

### Links generated for individual customers

- Field Sales agreement/customer record: `<approved Field Sales origin>/field-agreement.html#token=<issued token>`.
- Commercial approval: `https://shop.home2smart.com/commercial-approval` with the application's issued authorization.
- Payment checkout: the provider URL returned for the authorized transaction, not a permanent public checkout link.

Use the application's issued link; do not make up tokens, copy a different customer's URL or treat a bare page URL as authorization. The Field Sales origin is controlled by `H2S_FIELD_SALES_ORIGIN`; its actual configured value was not inspected.

**Public verification:** unauthenticated HEAD requests to `/dash`, `/sales.html`, `/portal`, `/residential` and `/commercial` returned HTTP 200 on their domains above. This establishes reachability only, not current role access, payment readiness, or deployment of the latest `retro-dev` code. Recent Strategy and Operations changes have not been deployed.

Route evidence: [frontend routing](../frontend/vercel.json), [dashboard shell](../frontend/dash.js), [representative routing](../frontend/sales-app.js), [customer-link generation](../backend/lib/fieldCommerce.ts).

The backend base is `https://h2s-backend.vercel.app`; it is not an employee login destination. `/api/forecast` is an authenticated management API, not a public forecasting webpage. Use the role-specific pages above for normal work.

## Why Forecast says unavailable locally

It is **not a requirement to deploy** before forecasting. The current isolated review server deliberately forces AI, research and the approved-catalog connection off. It also rejects external provider traffic. Changing a browser URL, deploying the static frontend, or setting an AI environment variable on that isolated fixture does not connect those services.

The deterministic financial engine already runs locally. The natural-language AI workflow cannot interpret the Greenville/Spartanburg scenario while its AI provider is disconnected. A valid profit forecast also needs prices, equipment/material costs, technician expenses, lead/conversion assumptions, processing fees and overhead; unknown inputs intentionally do not become zero.

### What works now without external services

1. Open Strategy & Forecasting.
2. Select **Assumptions & Sources** / **Review model assumptions**.
3. Enter the market, representatives, sales/conversion assumptions, technician capacity and payment timing.
4. Without an approved catalog connection, explicitly select **hypothetical** selling prices. Enter equipment/material costs for every service, technician pay, travel, processing fees, overhead and representative tenure/commission assumptions.
5. Select **Calculate reviewed assumptions**. Results are deterministic scenario estimates, not researched market intelligence or approved local prices.

Calculation, refinement through editable inputs, scenario comparison and session-only saved scenarios do not require a paid AI call. Conversational interpretation does.

### Connecting conversational forecasting

Use a real authorized **local backend or private staging backend**, rather than the isolated fixture:

1. Run the existing backend with `npm --prefix backend run dev` using an approved non-production database/auth configuration. This command is documented, not started by this change.
2. Serve the dashboard against that backend's existing API base, with the corresponding authenticated ADMIN session and permitted origin. Do not point test writes at production.
3. Separately authorize the existing OpenAI connection. Both server-side `H2S_FORECAST_AI_ENABLED=true` and `OPENAI_API_KEY` are required. Reuse the existing provider; do not put a key in browser code. AI requests can incur usage charges.
4. To retrieve dated Census facts, supply a server-side `CENSUS_API_KEY` and do not set `H2S_FORECAST_RESEARCH_ENABLED=false`. The connector still must successfully retrieve the requested geography; it does not supply competition, wage, advertising or regulatory research.
5. To use approved prices, authorize the existing published-catalog reader. It currently requires both `H2S_FIELD_CATALOG_ADMIN_ENABLED=true` and `H2S_FIELD_SALES_ENABLED=true`, ADMIN access, the catalog-read RPC and genuinely published/approved catalog records. Review the broader Field Sales gate implications before changing them. Do not publish proposed JSON to make this work.
6. Verify authenticated Forecast `GET` capabilities, then an explicit `POST` calculation and authorized AI interpretation. Confirm source versions, research dates, unavailable assumptions and independently calculated results.

No paid connection, live key, production activation or deployment was enabled here. Persistent/shared scenarios and missing research providers remain separate approved work.

Implementation/configuration evidence: [Forecast route](../backend/app/api/forecast/route.ts), [isolated provider restrictions](../tools/dev-review/walkthrough-fixture.cjs), [integration details](./FORECAST_INTEGRATION_PLAN.md).

## Local management review links

These are temporary, isolated sample-data previews, not URLs to distribute to employees or customers:

- Operations: https://127.0.0.1:50281/sales-review?screen=operations
- Selected installation: https://127.0.0.1:50281/sales-review?screen=installationDetail&job=00000000-0000-4000-8000-000000000137&section=overview
- Scheduling: https://127.0.0.1:50281/sales-review?screen=scheduling&job=00000000-0000-4000-8000-000000000137&section=technician
- Reconciliation: https://127.0.0.1:50281/sales-review?screen=reconciliation
- Strategy: https://127.0.0.1:50277/sales-review?screen=strategy
- Representative home: http://127.0.0.1:50276/sales-review?screen=home
- Leads: http://127.0.0.1:50276/sales-review?screen=leads
- Quotes: http://127.0.0.1:50276/sales-review?screen=quotes
- Orders: http://127.0.0.1:50276/sales-review?screen=orders
- Earnings: http://127.0.0.1:50276/sales-review?screen=earnings
