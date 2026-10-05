# SPL engineering workflow

User request -> Alley -> relevant SPL context -> decomposition -> shared contract -> owner and skill assignment -> implementation -> integration -> Ekko QA -> Prism review when architectural risk matters -> Cypher review when security matters -> Doc release preparation when deployment matters -> Alley validation -> required human approval -> production.

Alley reads the global protocol and this repository's instructions, then routes by `OWNERSHIP.md`.
Forge and client owners agree request, response, error, authorization, and type changes before parallel API work.
Vault agrees schema and migration order with Forge and Doc before a persistence change.
Shared files have one writer and explicit review handoffs.
Relevant tests run before Alley reports completion; the agent report includes actual commands and outcomes.
Use `DEPLOYMENT.md` for SPL-specific Fly, Neon, Tigris, desktop, and TestFlight preparation.
Production deployment and destructive production data changes require human approval.
