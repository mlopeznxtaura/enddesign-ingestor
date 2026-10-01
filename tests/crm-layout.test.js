import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractHTMLStructure } from '../shared/structure-extract.js';
import { runAnatomyPipeline } from '../shared/anatomy-pipeline.js';
import { generateDeterministicCodeJs } from '../shared/deterministic-coder.js';
import { bindActionsToView } from '../shared/action-binder.js';
import { runManifestValidationRules } from '../shared/checker-registry.js';

const crmHtml = readFileSync(join(process.cwd(), 'data', 'perf-test-crm-pipeline.html'), 'utf8');

describe('CRM pipeline fixture (v3)', () => {
  it('extracts multiple layout regions not only top_bar', () => {
    const structure = extractHTMLStructure(crmHtml);
    expect(structure.domain).toBe('crm-pipeline');
    const ids = structure.views.map((v) => v.id);
    expect(ids).toContain('top_bar');
    expect(ids).toContain('sidebar');
    expect(ids).toContain('kanban');
    expect(ids).toContain('right_panel');
    expect(ids.some((id) => id.includes('modal') || id.includes('add_lead'))).toBe(true);
    expect(structure.views.length).toBeGreaterThanOrEqual(4);
  });

  it('manifest tree has bidirectional actions with ownerId', () => {
    const structure = extractHTMLStructure(crmHtml);
    const { manifest } = runAnatomyPipeline(structure);
    expect(manifest.views.length).toBeGreaterThanOrEqual(4);
    expect(manifest.actions.length).toBeGreaterThan(0);
    const orphans = manifest.actions.filter((a) => !a.ownerId);
    expect(orphans.length).toBeLessThan(manifest.actions.length);
    expect(manifest.files.some((f) => f.templateType === 'python_stl_export')).toBe(false);
  });

  it('generates LeadSchema and modal form fields', () => {
    const structure = extractHTMLStructure(crmHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const schema = manifest.files.find((f) => f.templateType === 'ts_schema');
    expect(schema).toBeDefined();
    expect(schema.path).toContain('LeadSchema');
    const schemaCode = generateDeterministicCodeJs(schema);
    expect(schemaCode).toContain('lead_name');
    expect(schemaCode).toContain('lead_company');
    expect(schemaCode).toContain('lead_value');
  });

  it('AppShell mounts sidebar main and right not only header', () => {
    const structure = extractHTMLStructure(crmHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const shell = manifest.files.find((f) => f.taskId === 'app_shell');
    const code = generateDeterministicCodeJs(shell, { manifestViews: manifest.views });
    expect(code).toContain('Sidebar');
    expect(code).toContain('MainPipeline');
    expect(code).toContain('RightPanel');
    expect(code).not.toMatch(/<main className="app-layout">\s*<TopBar/);
  });

  it('binding pass wires handlers into TopBar', () => {
    const structure = extractHTMLStructure(crmHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const topBarMeta = manifest.views.find((v) => v.id === 'top_bar');
    const topBarEntry = manifest.files.find((f) => f.taskId === 'top_bar');
    let code = generateDeterministicCodeJs(topBarEntry);
    code = bindActionsToView(code, topBarMeta, manifest.actions);
    expect(code).toMatch(/_handler/);
    expect(code).toContain('onClick');
    expect(topBarMeta.actionRefs.length).toBeGreaterThan(0);

    const rules = runManifestValidationRules(code, {
      ...topBarEntry,
      validationRules: [{ id: 'view_imports_handlers', severity: 'high' }],
      actions: manifest.actions.filter((a) => a.ownerId === 'top_bar'),
    });
    const handlerRule = rules.find((r) => r.id === 'view_imports_handlers');
    expect(handlerRule?.pass).toBe(true);
  });

  it('layout coverage is not a fake 70% on multi-region design', () => {
    const structure = extractHTMLStructure(crmHtml);
    const result = runAnatomyPipeline(structure);
    expect(result.layoutCoverage.total).toBeGreaterThanOrEqual(4);
    expect(result.layoutCoverage.score).toBeGreaterThanOrEqual(80);
    expect(result.stats.sourceViews).toBeGreaterThanOrEqual(4);
  });
});
