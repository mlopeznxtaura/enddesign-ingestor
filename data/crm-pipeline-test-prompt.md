# CRM Pipeline — Test Prompt (v3)

Use `data/perf-test-crm-pipeline.html` on https://app20.nextaura.fit after deploy.

## Expected ingest

- `pipeline: anatomy-first-v3`
- `domain: crm-pipeline`
- `manifest.views.length` ≥ 5 (top_bar, sidebar, kanban, right_panel, modal)
- `manifest.actions[]` with `ownerId` on each action
- `layoutCoverage` reflects real view count (not 70% on 0/0)

## Expected build

- Views: `Sidebar.tsx`, `MainPipeline.tsx`, `RightPanel.tsx`, `TopBar.tsx`, `AddLeadModal.tsx`
- `src/generated/LeadSchema.ts`
- `AppShell.tsx` with `app-sidebar`, `app-main`, `app-right` regions
- Log: `Binding pass wired handlers: ...`
- Fidelity log: `structure X% · wiring Y% · fields Z%`

## Success criteria

- No single-view collapse (not only TopBar in shell)
- `view_imports_handlers` runs in stepResults for views with actions
- Honest overall fidelity = min(structure, wiring, fields, compile) — not fake 70%
