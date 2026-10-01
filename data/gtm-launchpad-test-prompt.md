# LaunchPad GTM — Test Prompt (Iteration 104)

Use this to pivot the ingestor from **CAD/AeroHub** to a **GTM / marketing campaign** application on https://app20.nextaura.fit

---

## Option A — Paste HTML (recommended)

1. Open **Build Console** on app20.
2. In the design ingest area, paste the **full contents** of:
   - `data/perf-test-gtm-launchpad.html`
3. Click **Ingest** (or your ingest action).
4. Confirm the response shows:
   - `pipeline: "anatomy-first"`
   - `domain: "gtm-marketing"` (or `dashboard`)
   - `manifest.files` length **&lt; 26** (not legacy param sprawl)
   - Views include: `top_bar`, `campaign_controls`, `analytics_dashboard`, `email_editor`, `ingest`
5. **Start Build** with **Skip blocked** enabled for first run.
6. Watch logs for:
   - `Deterministic codegen (Python bricklayer): src/config/...` or `src/stl_export.py` should **NOT** appear
   - `Deterministic codegen (JS template): src/views/...` for panels
   - `Deterministic codegen (Python bricklayer):` for `ts_config` / `ts_action_handler` only
7. **Export Zip** — scaffold should be a React GTM shell, not build123d STL.

---

## Option B — Natural language brief (freeform fallback)

Paste this if you want to test outline parsing (legacy / IBM DAG path — **not** anatomy-first):

```
Build LaunchPad GTM — a marketing campaign command center for B2B SaaS teams.

Top bar: New Campaign, Open, Launch Campaign, Export Report.

Left column — Campaign Controls:
- Campaign Settings: name, monthly budget, start/end dates
- Audience ICP: segment, company size, industry, geo
- Channel Mix: email %, LinkedIn %, Google %, primary CTA

Center — Campaign Analytics Dashboard:
- Funnel chart from impressions to pipeline
- Derived components: landing hero, 5-touch email sequence, LinkedIn carousel, UTM bundle

Right column — Email Sequence Editor with HTML template for Email 1 (problem framing).

Bottom ingest zone: drop campaign brief PDF/Notion/HTML, Ingest Brief, Clear.

Target users: VP Marketing and Head of Growth at 50–500 employee SaaS companies.
Primary CTA: Book Demo. Budget $25k/month. Q3 2026 launch window.
```

Expect warnings: freeform / line_* nodes unless you use Option A HTML.

---

## Option C — One-shot agent prompt (after ingest)

After Option A ingest succeeds, optional watsonx enrichment prompt for any non-deterministic nodes:

```
You are scaffolding LaunchPad GTM — a B2B marketing campaign workspace.
Domain: gtm-marketing. No CAD, no STL, no build123d, no Three.js unless the viewport is a chart placeholder.

Implement:
- Config modules for campaign_settings, audience_icp, channel_mix (TypeScript defaults + labels).
- Action handlers: launch_campaign, export_report, ingest_brief, clear_brief.
- React views: TopBar, CampaignControls panel, Analytics dashboard (cards + funnel placeholders), EmailSequence editor, IngestPanel for brief upload.
- App shell: 3-column layout + ingest strip; honest fidelity over fake metrics.

Use Tailwind-style class names from the HTML. Keep handlers thin — return { ok, action, input } stubs.
```

---

## Expected manifest shape (sanity check)

| Layer | Examples |
|-------|----------|
| Config | `campaign_settings`, `audience_icp`, `channel_mix` → `ts_config` |
| Views | `TopBar`, `CenterViewport` or analytics view, `CodeEditorView`, `IngestPanel`, `DerivedOutput` |
| Actions | `launch_campaign`, `export_report`, `ingest_brief` → `ts_action_handler` |
| Shell | `AppShell.tsx` grid |

**Not expected:** `python_stl_export`, `build123d`, wheel/stator param names.

---

## API smoke test (local or CE)

```bash
curl -s -X POST https://app20.nextaura.fit/api/pipeline/ingest \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"<paste minified html or load file>\", \"type\": \"ui\", \"useIbm\": false}" \
  | jq '{pipeline, domain, files: .manifest.files | length, views: .structure.views | map(.id)}'
```

---

## Success criteria

- [ ] Ingest returns `anatomy-first` pipeline
- [ ] Domain is marketing (`gtm-marketing`), not `cad-stl`
- [ ] Manifest has view TSX paths under `src/views/`
- [ ] Build completes without STL/Python CAD files
- [ ] Export zip `scaffold-meta.json` lists `pipeline: anatomy-first-v2`
- [ ] Health still shows `pythonBricklayer.ok` (bricklayer used for configs/handlers, not STL)

---

## Fixture file

HTML source: `data/perf-test-gtm-launchpad.html`
