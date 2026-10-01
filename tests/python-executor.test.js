import { describe, it, expect } from 'vitest';
import {
  PYTHON_BRICKLAYER_TEMPLATES,
  executeCadPython,
  isPythonBricklayerAvailable,
  shouldUsePythonBricklayer,
  checkPythonBricklayerHealth,
} from '../shared/python-executor.js';
import { generateDeterministicCode, generateDeterministicCodeJs } from '../shared/deterministic-coder.js';

describe('python bricklayer bridge', () => {
  it('shouldUsePythonBricklayer only for supported deterministic templates', () => {
    expect(
      shouldUsePythonBricklayer({ templateType: 'python_stl_export', deterministic: true }),
    ).toBe(true);
    expect(
      shouldUsePythonBricklayer({ templateType: 'react_view_ingest', deterministic: true }),
    ).toBe(false);
    expect(
      shouldUsePythonBricklayer({ templateType: 'python_stl_export', deterministic: false }),
    ).toBe(false);
  });

  it('PYTHON_BRICKLAYER_TEMPLATES matches cad_executor capabilities', () => {
    expect(PYTHON_BRICKLAYER_TEMPLATES.has('ts_config')).toBe(true);
    expect(PYTHON_BRICKLAYER_TEMPLATES.has('react_app_shell')).toBe(false);
  });

  it('executeCadPython generates STL export when python is available', async () => {
    if (!isPythonBricklayerAvailable()) return;

    const code = await executeCadPython({ templateType: 'python_stl_export' });
    expect(code).toContain('build123d');
    expect(code).not.toContain('React');
  });

  it('generateDeterministicCode prefers python for stl when available', async () => {
    const entry = { templateType: 'python_stl_export', deterministic: true };
    const result = await generateDeterministicCode(entry);
    if (!isPythonBricklayerAvailable()) {
      expect(result?.source).toBe('javascript');
      return;
    }
    expect(result?.source).toBe('python');
    expect(result?.code).toContain('build123d');
  });

  it('generateDeterministicCode uses JS for react views', async () => {
    const entry = {
      templateType: 'react_view_ingest',
      deterministic: true,
      viewType: 'ingest_panel',
      desc: 'Ingest',
      taskId: 'ingest_panel',
    };
    const jsCode = generateDeterministicCodeJs(entry);
    expect(jsCode).toContain('React');

    const result = await generateDeterministicCode(entry);
    expect(result?.source).toBe('javascript');
    expect(result?.code).toContain('React');
  });

  it('checkPythonBricklayerHealth reports script path', async () => {
    const health = await checkPythonBricklayerHealth();
    expect(health.scriptPath).toContain('cad_executor.py');
    if (health.ok) {
      expect(health.python).toMatch(/Python/i);
    }
  });
});
