# SPL architecture context

## Product and applications

SPL Control Financiero is a Spanish-language internal operations and finance application for SPL and 5to Elemento.
The implemented areas include events, expenses, payments and settlements, weekly payroll, monthly reports, settings, and owner/coordinator access.
The web UI in `src/` uses React 19, TypeScript, Vite 8, and CSS in `src/styles.css` and feature stylesheets.
The Windows desktop app in `src-tauri/` uses Tauri 2 and Rust to launch a bundled Node/Fastify backend on a loopback port and display the web UI.
The mobile app in `mobile/` uses Expo 57, React Native 0.86, Expo Router, TypeScript, and Expo SecureStore.
Pulse is active for this repository.

## API and data flow

`server/app.ts` builds the Fastify 5 HTTP API under `/api/`; `server/domain.ts` holds Zod request schemas and key domain types.
The web client calls the API through `src/api.ts`, using cookies or development bearer auth.
The mobile client calls the central API through `mobile/src/api.ts`, using a bearer token stored in Expo SecureStore.
Routes call repository, payroll, weekly-payroll, session, and report services in `server/`.
The production central server starts at `server/index.ts` and uses PostgreSQL through `pg` with handwritten SQL.
There is no ORM or separate shared-package workspace.
The database schema is managed by ordered SQL files in `server/db/migrations/` and `scripts/migrate.ts`.
The Windows desktop backend in `server/desktop.ts` uses `PersistentDevelopmentStore` to keep private JSON data under the app data directory.
Local development in `server/dev.ts` can use disposable in-memory data.
The web and mobile clients have separate API type declarations, and web weekly-payroll types import from the server.
`server/weekly.ts` also imports a value from `src/`; treat these existing cross-boundary imports as shared contracts when changing them.

## Identity and authorization

Google identity is verified in the server; desktop uses a system-browser OAuth callback, and mobile uses native Google Sign-In.
Sessions use the `spl_session` cookie or a bearer token.
Roles are `admin`, `owner`, and `coordinator`.
The coordinator has restricted finance access and business-unit-scoped event data.
Review both route authorization and repository filtering for changes to access or response fields.
Do not print values from `.env` or OAuth credential files.

## Build, test, and deployment

The root package uses npm with `package-lock.json` and a `mobile` workspace.
Root checks are `npm run build`, `npm run build:server`, `npm test` for Vitest, and `npm run test:e2e` for Playwright.
Desktop packaging uses `npm run build:desktop`, `npm run desktop:build`, and Rust tests under `src-tauri/`.
Mobile checks use `npm run lint -w mobile` and TypeScript validation from the mobile directory.
The central API has a Dockerfile and Fly configuration in `Dockerfile` and `fly.toml`.
`DEPLOYMENT.md` documents Fly deployment, Neon PostgreSQL, Tigris backups, migration and restoration, and Expo/EAS TestFlight.
No repository CI workflow is currently present.
Do not infer that documented cloud resources are provisioned or that deployment has been run.

## Areas needing coordination

The central and desktop backends share Fastify routes but use different persistence implementations.
Changes to `server/domain.ts`, `server/weekly.ts`, `src/api.ts`, or `mobile/src/api.ts` can affect several owners.
Authentication, finance calculations, migrations, backup/restore, and desktop packaging carry high regression or data risk.
Current source and tests contain in-progress uncommitted work, which must be preserved.
