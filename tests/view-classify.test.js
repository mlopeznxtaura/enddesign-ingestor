import { describe, it, expect } from 'vitest';
import { extractHTMLStructure } from '../shared/structure-extract.js';
import { runAnatomyPipeline } from '../shared/anatomy-pipeline.js';

const ingestAppHtmlSnippet = `
<header class="top-bar"><div class="brand-title">EndDesign</div></header>
<div class="main">
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Ingest</span></div>
    <div class="panel-body">
      <div class="drop-zone" id="dropZone">Drop design file</div>
      <textarea id="designInput"></textarea>
      <button class="btn btn-primary" id="ingestBtn">Ingest & Map</button>
      <button class="btn btn-ghost" id="clearBtn">Clear</button>
    </div>
  </div>
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Function DAG</span></div>
    <div class="dag-canvas" id="dagCanvas"></div>
  </div>
  <div class="panel">
    <div class="panel-header"><span class="panel-title">Derived Components</span></div>
    <div class="panel-body" id="outputPanel"></div>
    <button class="btn-export" id="exportAll">Export All</button>
  </div>
</div>`;

describe('UI_VIEW vs ACTION_BUTTON', () => {
  it('extracts views from ingestor-style HTML', () => {
    const structure = extractHTMLStructure(ingestAppHtmlSnippet);
    expect(structure.views?.length).toBeGreaterThan(2);
    expect(structure.views.some((v) => v.viewType === 'ingest_panel')).toBe(true);
    expect(structure.views.some((v) => v.viewType === 'dag_canvas')).toBe(true);
    expect(structure.views.some((v) => v.viewType === 'derived_output')).toBe(true);
  });

  it('binds ingest/clear buttons to ingest view not standalone scaffold-only', () => {
    const structure = extractHTMLStructure(ingestAppHtmlSnippet);
    const ingest = structure.views.find((v) => v.id === 'ingest' || v.viewType === 'ingest_panel');
    expect(ingest).toBeDefined();
    expect(ingest.actions?.length).toBeGreaterThan(0);
    const standaloneHandlers = structure.actions.filter((a) => !a.parentView);
    expect(standaloneHandlers.length).toBeLessThan(5);
  });

  it('manifest includes view tsx files not only handlers', () => {
    const structure = extractHTMLStructure(ingestAppHtmlSnippet);
    structure.domain = 'app-ui';
    const { manifest } = runAnatomyPipeline(structure);
    const views = manifest.files.filter((f) => f.path.startsWith('src/views/'));
    expect(views.length).toBeGreaterThan(0);
    expect(manifest.files.some((f) => f.templateType === 'react_app_shell')).toBe(true);
  });
});
