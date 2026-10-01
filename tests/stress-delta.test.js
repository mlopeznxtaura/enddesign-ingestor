import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractHTMLStructure } from '../shared/structure-extract.js';
import { runAnatomyPipeline } from '../shared/anatomy-pipeline.js';
import { generateDeterministicCodeJs } from '../shared/deterministic-coder.js';
import { bindActionsToView } from '../shared/action-binder.js';
import { canonicalActionId } from '../shared/action-id.js';
import { actionFnName } from '../shared/view-classify.js';

const stressA = readFileSync(
  join(process.cwd(), 'data', 'perf-test-stress-topbar-only.html'),
  'utf8',
);
const stressB = readFileSync(
  join(process.cwd(), 'data', 'perf-test-stress-full-layout.html'),
  'utf8',
);

describe('delta stress — action id canonicalization', () => {
  it('uses data-action not label for handler ids', () => {
    expect(canonicalActionId('save_postmortem', '', 'Save &amp; Continue')).toBe('save_postmortem');
    expect(canonicalActionId('confirm_close', '', 'Yes, close')).toBe('confirm_close');
    expect(canonicalActionId('Generate_Report', '', 'generate report (again)')).toBe(
      'generate_report',
    );
    expect(canonicalActionId('silence_alerts', '', 'Silence 15m')).toBe('silence_alerts');
  });

  it('handler fn names derive from canonical action id', () => {
    expect(actionFnName('save_postmortem')).toBe('savePostmortem_handler');
    expect(actionFnName('generate_report')).toBe('generateReport_handler');
  });
});

describe('delta stress A — top bar only', () => {
  it('runs anatomy pipeline (views-only ingest gate)', () => {
    const structure = extractHTMLStructure(stressA);
    expect(structure.views.length).toBe(1);
    const result = runAnatomyPipeline(structure);
    expect(result.pipeline).toBe('anatomy-first-v3');
    expect(result.manifest.views.length).toBeGreaterThanOrEqual(1);
  });

  it('includes clear_queue in top_bar actions and executionOrder', () => {
    const structure = extractHTMLStructure(stressA);
    const topBar = structure.views.find((v) => v.id === 'top_bar');
    const actionIds = topBar.actions.map((a) => a.id);
    expect(actionIds).toContain('clear_queue');
    expect(actionIds).toContain('save_postmortem');
    expect(actionIds).toContain('generate_report');
    expect(actionIds).not.toContain('save_amp_continue');

    const { manifest } = runAnatomyPipeline(structure);
    expect(manifest.executionOrder).toContain('clear_queue');
    expect(manifest.executionOrder).toContain('save_postmortem');
    expect(manifest.actions.length).toBe(6);
  });

  it('TopBar renders real data-action buttons not fake Action', () => {
    const structure = extractHTMLStructure(stressA);
    const { manifest } = runAnatomyPipeline(structure);
    const topBarEntry = manifest.files.find((f) => f.taskId === 'top_bar');
    const code = generateDeterministicCodeJs(topBarEntry, {
      manifestActions: manifest.actions,
    });
    expect(code).toContain('data-action="clear_queue"');
    expect(code).toContain('data-action="save_postmortem"');
    expect(code).not.toMatch(/<button[^>]*>Action<\/button>/);

    const topBarMeta = manifest.views.find((v) => v.id === 'top_bar');
    const bound = bindActionsToView(code, topBarMeta, manifest.actions);
    expect(bound).toContain('savePostmortem_handler');
    expect(bound).toContain('clearQueue_handler');
    expect(bound).toContain('onClick');
  });

  it('ingest fidelity is not a placeholder 70 on 0/0', () => {
    const structure = extractHTMLStructure(stressA);
    const result = runAnatomyPipeline(structure);
    expect(result.layoutCoverage.total).toBeGreaterThan(0);
    expect(result.layoutCoverage.score).not.toBe(70);
  });
});

describe('delta stress B — multi-region layout', () => {
  it('extracts multiple layout regions', () => {
    const structure = extractHTMLStructure(stressB);
    const ids = structure.views.map((v) => v.id);
    expect(ids).toContain('top_bar');
    expect(ids).toContain('sidebar');
    expect(ids).toContain('kanban');
    expect(ids).toContain('right_panel');
    expect(ids).toContain('chart_panel');
    expect(ids.some((id) => id.includes('confirm'))).toBe(true);
    expect(ids.some((id) => id.includes('postmortem'))).toBe(true);
    expect(structure.views.length).toBeGreaterThanOrEqual(7);
  });

  it('dedupes duplicate data-action Generate_Report to one handler', () => {
    const structure = extractHTMLStructure(stressB);
    const topBar = structure.views.find((v) => v.id === 'top_bar');
    const dupes = topBar.actions.filter((a) => a.id === 'generate_report');
    expect(dupes.length).toBe(1);

    const { manifest } = runAnatomyPipeline(structure);
    const reportActions = manifest.actions.filter((a) => a.id === 'generate_report');
    expect(reportActions.length).toBe(1);
  });

  it('AppShell mounts more than TopBar alone', () => {
    const structure = extractHTMLStructure(stressB);
    const { manifest } = runAnatomyPipeline(structure);
    const shell = manifest.files.find((f) => f.taskId === 'app_shell');
    const code = generateDeterministicCodeJs(shell, { manifestViews: manifest.views });
    expect(code).toContain('Sidebar');
    expect(code).toContain('MainPipeline');
    expect(code).toContain('RightPanel');
    expect(code).not.toMatch(/<main className="app-layout">\s*<TopBar/);
  });
});
