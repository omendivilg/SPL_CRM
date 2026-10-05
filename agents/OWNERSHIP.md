# SPL code ownership

Global agent identities are defined in `~/.codex/engineering/TEAM.md`.
This map assigns SPL files and review responsibilities.
Alley names one writer for shared files before parallel work.

| Area | Primary owner | Coordination |
|---|---|---|
| `server/app.ts`, routes, service and domain behavior in `server/` | Forge | Cypher reviews access changes; Vault reviews persistence contracts |
| `server/db/migrations/`, schema and data migration design | Vault | Forge aligns API behavior; Doc aligns release order |
| PostgreSQL repositories and local desktop persistence in `server/` | Forge for behavior, Vault for data design | Alley assigns one writer per file |
| `src/`, `index.html`, `public/`, web styling | Nova | Forge agrees API contracts; Ekko validates user flows |
| `mobile/` | Pulse | Forge agrees API contracts; follow `mobile/AGENTS.md` |
| `src-tauri/`, desktop bundle scripts, `Dockerfile`, `fly.toml`, deployment tooling | Doc | Forge owns bundled backend behavior; Nova owns web UI |
| `tests/` and test harness | Ekko | Feature owner coordinates assertions and fixes |
| Colocated `*.test.ts` files | Owning domain agent | Ekko reviews coverage and E2E implications |
| `package.json`, `package-lock.json`, TypeScript and Vite configuration | Alley assigns the affected owner | Doc checks build and packaging impact |
| `scripts/migrate.ts`, `scripts/import-local.ts`, `scripts/backup.ts` | Vault for data semantics, Doc for operation | One writer assigned by Alley |
| `AGENTS.md`, `agents/`, `.agents/skills/` | Alley | Prism reviews cross-agent process changes |

Cypher owns security review across sensitive areas, not routine edits to every authentication file.
Prism owns architecture review, not other owners' implementations.
Ekko may add tests but must not change production behavior solely to make a test pass.
For `server/domain.ts`, `server/weekly.ts`, `src/api.ts`, and `mobile/src/api.ts`, agree the contract before separate client and server edits.
No two agents edit the same file concurrently without an explicit Alley handoff.
