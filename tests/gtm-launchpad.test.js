import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractHTMLStructure } from '../shared/structure-extract.js';
import { runAnatomyPipeline } from '../shared/anatomy-pipeline.js';

const gtmHtml = readFileSync(join(process.cwd(), 'data', 'perf-test-gtm-launchpad.html'), 'utf8');

describe('GTM LaunchPad fixture', () => {
  it('detects gtm-marketing domain not cad-stl', () => {
    const structure = extractHTMLStructure(gtmHtml);
    expect(structure.domain).toBe('gtm-marketing');
    expect(structure.domain).not.toBe('cad-stl');
  });

  it('extracts campaign views and ingest zone', () => {
    const structure = extractHTMLStructure(gtmHtml);
    const ids = structure.views.map((v) => v.id);
    expect(ids).toContain('top_bar');
    expect(ids).toContain('ingest');
    expect(ids).toContain('campaign_controls');
    expect(ids).toContain('analytics_dashboard');
    expect(ids).toContain('email_editor');
  });

  it('anatomy manifest has no STL export', () => {
    const structure = extractHTMLStructure(gtmHtml);
    const { manifest, pipeline } = runAnatomyPipeline(structure);
    expect(pipeline).toBe('anatomy-first-v3');
    expect(manifest.files.length).toBeLessThan(26);
    expect(manifest.files.some((f) => f.templateType === 'python_stl_export')).toBe(false);
    expect(manifest.files.some((f) => f.path.includes('src/views/'))).toBe(true);
  });
});
