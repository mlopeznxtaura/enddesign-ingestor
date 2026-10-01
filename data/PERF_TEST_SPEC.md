# EndDesign Ingestor — Performance Test Spec (v1)

Use this to benchmark ingest → DAG → build on app20. Run each case, record metrics, compare scaffold downloads.

## Pass criteria (minimum)

| Step | Pass |
|------|------|
| Ingest status | Shows `cad-stl`, fidelity ≥ 70%, **not** `line_0` IDs |
| DAG nodes | ≥ 15 nodes (HTML case), ≥ 8 (PNG case) |
| Build | Completes without error; watsonx logs in Build Console |
| Scaffold | ≥ 12 files; includes `wheel_part` or `stator_ring` semantics |
| No junk | No markdown fences, no duplicate `AppShell.tsx`, no React inside `.py` |

## Case A — Full HTML paste (primary)

1. Open https://app20.nextaura.fit (hard refresh).
2. **Do not** use freeform bullets — paste **entire** contents of `data/perf-test-aerohub.html`.
3. Design type: **UI / Screen Design**.
4. Click **Ingest & Map**.
5. Expect status like: `Pipeline mapped DAG [cad-stl] fidelity 100%`.
6. Expect **≥ 18 tasks**, node IDs like `wheel_part`, `outer_diameter`, `stl_export`.
7. **Start Build** → wait for Complete → **Download Scaffold**.

Record: ingest time, task count, file count, domain, top 3 file paths.

## Case B — HTML file drop

1. Drop `data/perf-test-aerohub.html` on the ingest bucket (or click bucket → pick file).
2. Same expectations as Case A.

## Case C — PNG screenshot drop

1. Export a PNG of the AeroHub mockup (or use any UI screenshot).
2. **Drop PNG** on bucket — status: `Image loaded — click Ingest & Map`.
3. Clear textarea placeholder if needed; click **Ingest & Map**.
4. Expect `cad-stl` or `app-ui`, ≥ 8 nodes from vision.
5. Build + download.

Note: PNG path needs Gemini vision on CE; watsonx-only fallback is weaker.

## Case C2 — PNG paste failure (negative test)

1. Paste only: `Dashboard with user table` (freeform text).
2. Expect **low** task count, `line_0` IDs — marks failed ingest path.

## Quick paste block (minimal HTML smoke test)

If full file is too large, paste this minimum — should still get `cad-stl` and part nodes:

```html
<!DOCTYPE html><html><body>
<div class="parameter-group"><div class="group-label">Wheel Part</div>
<div class="input-row"><label>Outer Diameter</label><input value="120"/></div>
<div class="input-row"><label>Rim Width</label><input value="8"/></div></div>
<div class="code-area">from build123d import *</div>
<button class="btn">Export STL</button>
</body></html>
```

## Metrics log template

```
Date:
Case: A | B | C
Ingest ms:
Domain:
Fidelity:
DAG nodes:
Tasks:
Build ms:
Files in scaffold:
Sample paths:
Pass/Fail:
Notes:
```
