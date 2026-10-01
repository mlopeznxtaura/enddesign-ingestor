import { describe, it, expect } from 'vitest';
import { runStepTests, formatStepTestLog } from '../shared/verify-step.js';

describe('runStepTests', () => {
  it('passes valid TSX component', () => {
    const file = {
      path: 'src/components/left_panel.tsx',
      content: `import React, { useState } from 'react';
export function LeftPanel() {
  const [v, setV] = useState(0);
  return <section><input onChange={() => setV(1)} /></section>;
}`,
    };
    const result = runStepTests(file, { domain: 'cad-stl', node: { type: 'ui', id: 'left_panel' }, taskId: 'left_panel' });
    expect(result.ok).toBe(true);
    expect(result.failed).toBe(0);
  });

  it('fails Python file with React content', () => {
    const file = {
      path: 'src/io/stl_export.py',
      content: `import React from 'react';
export const CodeEditor = () => <div/>;`,
    };
    const result = runStepTests(file, {
      domain: 'cad-stl',
      node: { type: 'io', id: 'stl_export' },
      taskId: 'stl_export',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.id === 'step_py_not_react')).toBe(true);
  });

  it('fails duplicate exports', () => {
    const file = {
      path: 'src/generated/wheel_part.tsx',
      content: `export const WheelPart = () => <div/>;
export function WheelPart() { return null; }`,
    };
    const result = runStepTests(file, { domain: 'cad-stl', node: { type: 'fn', id: 'wheel_part' }, taskId: 'wheel_part' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.id === 'step_single_export')).toBe(true);
  });

  it('fails Python syntax in TSX (EXT_MISMATCH class)', () => {
    const file = {
      path: 'src/generated/wheel_part.tsx',
      content: `wheel_part = {"radius": 10, "width": 5}
def build_wheel():
    return wheel_part`,
    };
    const result = runStepTests(file, {
      domain: 'cad-stl',
      node: { type: 'fn', id: 'wheel_part' },
      taskId: 'wheel_part',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.id === 'step_ts_not_python')).toBe(true);
  });

  it('buildStepRepairPrompt FATAL ERROR for python in tsx', async () => {
    const { buildStepRepairPrompt } = await import('../shared/step-repair.js');
    const file = { path: 'src/generated/wheel_part.tsx', content: 'x = {"a": 1}' };
    const failed = [{ id: 'step_ts_not_python', pass: false, message: 'looks like Python' }];
    const { instructions } = buildStepRepairPrompt(failed, file, { type: 'fn' }, 'cad-stl');
    expect(instructions).toMatch(/FATAL ERROR/i);
  });

  it('flags deck.gl on CAD viewport', () => {
    const file = {
      path: 'src/components/center_viewport.tsx',
      content: `import { DeckGL } from '@deck.gl/react';
export function CenterViewport() { return <DeckGL />; }`,
    };
    const result = runStepTests(file, {
      domain: 'cad-stl',
      node: { type: 'ui', id: 'center_viewport' },
      taskId: 'center_viewport',
    });
    expect(result.issues.some((i) => i.id === 'step_cad_no_map_lib')).toBe(true);
  });

  it('formatStepTestLog returns pass and fail lines', () => {
    const result = runStepTests({
      path: 'src/generated/x.ts',
      content: '',
    });
    const lines = formatStepTestLog(result);
    expect(lines.some((l) => l.message.includes('FAIL'))).toBe(true);
  });
});
