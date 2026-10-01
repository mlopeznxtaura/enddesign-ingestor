import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractHTMLStructure } from '../shared/structure-extract.js';
import { runAnatomyPipeline } from '../shared/anatomy-pipeline.js';
import { generateDeterministicCodeJs, canGenerateDeterministic } from '../shared/deterministic-coder.js';

const aerohubHtml = readFileSync(
  join(process.cwd(), 'data', 'perf-test-aerohub.html'),
  'utf8',
);

describe('anatomy-first pipeline', () => {
  it('produces consolidated manifest fewer than legacy 26 param tasks', () => {
    const structure = extractHTMLStructure(aerohubHtml);
    const result = runAnatomyPipeline(structure);

    expect(result.pipeline).toBe('anatomy-first-v3');
    expect(result.manifest.files.length).toBeLessThan(26);
    expect(result.manifest.meta.deterministicFiles).toBeGreaterThan(0);
    expect(result.taskPlan.manifest).toBeDefined();
  });

  it('topo order places configs before ui and io', () => {
    const structure = extractHTMLStructure(aerohubHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const order = manifest.executionOrder;
    const configIdx = order.findIndex((id) => id.includes('wheel') || id === 'wheel_part');
    const stlIdx = order.indexOf('stl_export');
    if (configIdx >= 0 && stlIdx >= 0) {
      expect(configIdx).toBeLessThan(stlIdx);
    }
  });

  it('deterministic coder produces valid TS config without LLM', () => {
    const structure = extractHTMLStructure(aerohubHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const configEntry = manifest.files.find((f) => f.templateType === 'ts_config');
    expect(configEntry).toBeDefined();
    expect(canGenerateDeterministic(configEntry)).toBe(true);
    const code = generateDeterministicCodeJs(configEntry);
    expect(code).toContain('Defaults');
    expect(code).not.toMatch(/^def /m);
    expect(code).not.toContain('import React');
  });

  it('deterministic stl export is Python only', () => {
    const structure = extractHTMLStructure(aerohubHtml);
    const { manifest } = runAnatomyPipeline(structure);
    const stl = manifest.files.find((f) => f.templateType === 'python_stl_export');
    expect(stl).toBeDefined();
    const code = generateDeterministicCodeJs(stl);
    expect(code).toContain('build123d');
    expect(code).not.toContain('React');
  });
});
