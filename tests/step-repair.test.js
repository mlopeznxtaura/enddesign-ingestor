import { describe, it, expect } from 'vitest';
import {
  MAX_STEP_REPAIR_ATTEMPTS,
  isCriticalFailure,
  buildStepRepairPrompt,
  applyDeterministicStepFix,
} from '../shared/step-repair.js';
import { runStepTests } from '../shared/verify-step.js';

describe('isCriticalFailure', () => {
  it('flags critical syntax failure', () => {
    const result = runStepTests({
      path: 'src/generated/x.ts',
      content: '',
    });
    expect(isCriticalFailure(result)).toBe(true);
  });

  it('does not flag medium-only failures as critical gate', () => {
    const result = {
      ok: true,
      issues: [{ id: 'step_cad_3d_stack', severity: 'medium', pass: false }],
    };
    expect(isCriticalFailure(result)).toBe(false);
  });
});

describe('buildStepRepairPrompt', () => {
  it('produces FATAL ERROR for Python in TSX', () => {
    const file = {
      path: 'src/generated/wheel_part.tsx',
      content: 'wheel_part = {"radius": 10}',
    };
    const failed = [
      { id: 'step_ts_not_python', pass: false, message: 'looks like Python', severity: 'critical' },
    ];
    const { instructions } = buildStepRepairPrompt(failed, file, { type: 'fn', id: 'wheel_part' }, 'cad-stl');
    expect(instructions).toContain('FATAL ERROR');
    expect(instructions).toContain('TypeScript/React');
  });
});

describe('applyDeterministicStepFix', () => {
  it('fixes stl_export.py with React content', () => {
    const file = {
      path: 'src/io/stl_export.py',
      name: 'stl_export.py',
      content: `import React from 'react';`,
    };
    const failed = [{ id: 'step_py_not_react', pass: false }];
    const fixed = applyDeterministicStepFix(file, failed, { type: 'io', id: 'stl_export' }, 'cad-stl');
    expect(fixed).toBe(true);
    expect(file.path).toBe('src/io/stl_export.py');
    expect(file.content).toContain('build123d');
  });
});

describe('step gate simulation', () => {
  const node = { type: 'fn', id: 'wheel_part' };
  const domain = 'cad-stl';

  async function simulateGate(file, repairFn, allowSkip = false) {
    let result = runStepTests(file, { domain, node, taskId: node.id });
    let attempts = 0;
    while (!result.ok && isCriticalFailure(result) && attempts < MAX_STEP_REPAIR_ATTEMPTS) {
      await repairFn(file, result.issues, attempts);
      attempts += 1;
      result = runStepTests(file, { domain, node, taskId: node.id });
    }
    const blocked = !result.ok && isCriticalFailure(result);
    return { ok: result.ok, attempts, blocked, allowSkip };
  }

  it('allows advance when repair succeeds on attempt 2', async () => {
    const file = {
      path: 'src/generated/wheel_part.ts',
      name: 'wheel_part.ts',
      content: `wheel_part = {"radius": 10}`,
    };
    const goodTs = `export const wheelPartConfig = { radius: 10 };`;
    let call = 0;
    const { ok, attempts } = await simulateGate(file, async (f) => {
      call += 1;
      if (call >= 1) f.content = goodTs;
    });
    expect(attempts).toBe(1);
    expect(ok).toBe(true);
  });

  it('blocks when still failing after max attempts', async () => {
    const file = {
      path: 'src/generated/wheel_part.ts',
      name: 'wheel_part.ts',
      content: `wheel_part = {"radius": 10}`,
    };
    const { ok, blocked, attempts } = await simulateGate(file, async () => {
      /* no fix */
    });
    expect(ok).toBe(false);
    expect(blocked).toBe(true);
    expect(attempts).toBe(MAX_STEP_REPAIR_ATTEMPTS);
  });
});
