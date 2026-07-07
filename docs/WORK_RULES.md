# Work Rules

This branch is intentionally isolated.

- Allowed branch: `codpexgreatwhale/08619`
- Do not checkout, merge, rebase, reset, delete, or push any other branch.
- Do not edit another project or another local checkout.
- Do not remove existing project files as part of this agent-system work.
- Push only to `origin codpexgreatwhale/08619`.

Use `npm run guard` before local scripts. The main scripts already run the guard
before build, test, typecheck, dev, and database commands.
