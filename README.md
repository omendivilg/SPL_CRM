# SPL Control Financiero

Initial application foundation for the Spanish-language SPL and 5to Elemento Windows system described in `../SPL_Implementation_Roadmap.md`.

## Current slice

- Responsive owner dashboard in the approved dark SPL palette.
- Business scope selector for consolidated SPL, SPL-owned events, and 5to Elemento.
- Financial overview, cash-flow visualization, expense categories, upcoming events, and budget alerts.
- Event workspace with unit filters, event selection, explainable cost totals, and named expense detail.
- Event creation with client, venue, date, price, and budget fields.
- API-backed event loading, creation, expense retrieval, loading states, empty states, and recoverable connection errors.
- Safe automatic retry for read requests without automatically retrying writes that could create duplicates.
- End-to-end verification for creating and reopening a pending-price reservation through the API.
- Fastify backend with an injectable event repository and PostgreSQL implementation.
- PostgreSQL migration for users, events, customer payments, expenses, settlements, payroll allocations, and audit history.
- Server-side owner and coordinator scoping with separate financial and operational response shapes.
- Unit and security tests for normal flows, boundaries, authorization failures, mass assignment, malformed input, oversized payloads, and injection-style strings.
- Controlled demonstration data clearly marked as provisional.

The event interface now uses the central API and no longer stores event records in browser-local storage.
Google authentication, persistent sessions, and role-specific access are implemented.
Customer-payment workflows, exports, and Windows packaging remain to be implemented.

## Backend configuration

The production server requires `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAIL`, and `GOOGLE_ALLOWED_EMAILS` environment variables.
Apply `server/db/migrations/001_initial.sql` to a PostgreSQL database before starting the API.
The API refuses to start when its database configuration is absent.

```powershell
npm run start:server
```

For local testing without PostgreSQL or Docker, `npm run dev` starts the interface and temporary in-memory backend together.
Its data resets when the combined development process stops.

```powershell
npm run dev
```

## Run locally

```powershell
npm install
npm run dev
```

## Verify

```powershell
npm run build
npm run build:server
npm test
npm run test:e2e
```
