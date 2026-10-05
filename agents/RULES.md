# SPL project rules

Preserve the current React/Vite, Fastify, Tauri, Expo, and PostgreSQL architecture unless a user authorizes a larger change.
Do not invent business modules from domain context or refactor unrelated areas during a focused task.
Use the active API shape in `server/app.ts` and Zod schemas in `server/domain.ts`; document and coordinate public contract changes.
Respect the different central PostgreSQL and desktop JSON persistence paths.
Do not modify `.env`, OAuth credential JSON, installed application data, or real production secrets during ordinary engineering work.
Do not commit credentials or print sensitive environment values.
Treat `server/db/migrations/`, import, backup, restore, authentication, and financial calculations as high-risk areas.
Require human approval before destructive production migrations, production restores, or production deployment.
Do not manually edit generated outputs such as `dist/`, `build-server/`, `desktop-backend-dist/`, `src-tauri/target/`, or generated native Expo projects.
Do not modify `CHANGELOG.md` or other marked generated files by hand.
Preserve uncommitted user work and avoid reformatting unrelated files.
For bugs, reproduce the user-visible failure as close as practical to the real workflow before fixing it.
Run relevant lint, build, and test checks; report any existing failures separately with evidence.
