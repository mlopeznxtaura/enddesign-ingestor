/**
 * Per-step pause-and-repair — prompts, deterministic fixes, critical-failure gating.
 */

import {
  defaultStlPythonExport,
  defaultCadViewportTsx,
} from './stl-templates.js';

export const MAX_STEP_REPAIR_ATTEMPTS = 3;

const LANGUAGE_MISMATCH_IDS = [
  'step_extension_match',
  'step_syntax',
  'step_py_not_react',
  'step_ts_not_python',
  'step_single_export',
];

function isReactContent(content = '') {
  return /import\s+React|from\s+['"]react['"]|<[A-Za-z]/.test(content);
}

function isPythonContent(content = '') {
  const t = content.trim();
  if (isReactContent(content)) return false;
  if (/^(import |from )/m.test(t)) return true;
  if (/^\w+\s*=\s*\{/.test(t)) return true;
  if (/^def\s+\w+/m.test(t)) return true;
  return false;
}

/**
 * Whether failed step tests should block the pipeline (hard gate).
 */
export function isCriticalFailure(stepResult) {
  if (!stepResult?.issues?.length) return false;
  return stepResult.issues.some(
    (i) =>
      i.severity === 'critical' ||
      (i.severity === 'high' && LANGUAGE_MISMATCH_IDS.includes(i.id)),
  );
}

/**
 * Build imperative repair instructions for LLM from failed step tests.
 */
export function buildStepRepairPrompt(failedTests, file, node, domain = 'app-ui') {
  const path = file?.path || '';
  const ext = (path.split('.').pop() || '').toLowerCase();
  const lines = [];

  for (const issue of failedTests) {
    switch (issue.id) {
      case 'step_extension_match':
      case 'step_ts_not_python':
        if (ext === 'tsx' || ext === 'ts') {
          lines.push(
            'FATAL ERROR: You wrote Python syntax into a .tsx/.ts file. Rewrite using only valid TypeScript/React syntax. Do NOT use Python dicts, def, or import from non-TS modules. Use TypeScript interfaces, export const/function, and React components with JSX.',
          );
        } else if (ext === 'py') {
          lines.push(
            'FATAL ERROR: This file must be Python only. No React, no JSX, no TypeScript.',
          );
        } else {
          lines.push(`FATAL ERROR: ${issue.message}`);
        }
        break;
      case 'step_syntax':
        lines.push(`SYNTAX ERROR: ${issue.message}`);
        break;
      case 'step_single_export':
        lines.push(
          `EXPORT ERROR: ${issue.message}. Keep exactly ONE export per symbol name.`,
        );
        break;
      case 'step_py_not_react':
        lines.push(
          'FATAL ERROR: Python file contains React/JSX. Rewrite as Python using build123d for CAD STL export.',
        );
        break;
      case 'step_cad_no_map_lib':
      case 'step_cad_3d_stack':
        lines.push(
          'Use @react-three/fiber Canvas + @react-three/drei OrbitControls. Do NOT use @deck.gl or mapbox.',
        );
        break;
      case 'step_ui_not_empty':
        lines.push(
          'UI component is too empty. Add useState, inputs, Monaco editor, or meaningful layout — not a bare div shell.',
        );
        break;
      default:
        if (!issue.pass) {
          lines.push(`${issue.id}: ${issue.message}`);
        }
    }
  }

  let language = 'TypeScript';
  if (node?.type === 'io' || ext === 'py') {
    language = 'Python/build123d';
  } else if (node?.type === 'ui' || ext === 'tsx') {
    language = 'TypeScript/React';
  } else if (domain === 'cad-stl' && node?.type === 'fn') {
    language = 'TypeScript (config objects or handlers — never Python dict syntax)';
  }

  return {
    instructions: lines.join('\n'),
    language,
  };
}

function stripDuplicateExports(content = '') {
  const lines = content.split('\n');
  const seen = new Set();
  return lines
    .filter((line) => {
      const m = line.match(/export\s+(?:const|function|class)\s+(\w+)/);
      if (!m) return true;
      if (seen.has(m[1])) return false;
      seen.add(m[1]);
      return true;
    })
    .join('\n');
}

/**
 * Apply template or structural fixes without LLM. Returns true if content changed.
 */
export function applyDeterministicStepFix(file, failedTests, node, domain = 'app-ui') {
  if (!file || !failedTests?.length) return false;

  for (const issue of failedTests) {
    if (issue.id === 'step_py_not_react' && file.path?.includes('stl_export')) {
      file.content = defaultStlPythonExport();
      file.path = 'src/io/stl_export.py';
      file.name = 'stl_export.py';
      return true;
    }

    if (issue.id === 'step_py_not_react' && file.path?.endsWith('.py')) {
      if (file.path.includes('stl')) {
        file.content = defaultStlPythonExport();
        file.path = 'src/io/stl_export.py';
        file.name = 'stl_export.py';
        return true;
      }
      return false;
    }

    if (issue.id === 'step_single_export' && file.content) {
      file.content = stripDuplicateExports(file.content);
      return true;
    }

    if (issue.id === 'step_cad_no_map_lib' || issue.id === 'step_cad_3d_stack') {
      file.content = defaultCadViewportTsx('Real-time 3D Viewport');
      return true;
    }
  }

  return false;
}

export { isPythonContent, isReactContent };
