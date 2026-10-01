/**
 * Per-step verification — one singular test suite after each file write.
 * Each check is independent so failures pinpoint the exact step/module.
 */

import { validateSyntax, pickExtension } from './codegen-utils.js';
import { findDuplicateExports } from './verify-scaffold.js';
import { runManifestValidationRules } from './checker-registry.js';

const WRONG_CAD_LIBS = [
  { pattern: /@deck\.gl/i, lib: '@deck.gl' },
  { pattern: /from ['"]mapbox-gl/i, lib: 'mapbox-gl' },
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

function test(id, pass, message, severity = 'critical') {
  return { id, pass, message, severity };
}

/**
 * Run all step tests for a single written file.
 * @returns {{ ok: boolean, tests: Array, issues: Array }}
 */
export function runStepTests(file, context = {}) {
  const { domain = 'app-ui', node = {}, taskId = '' } = context;
  const path = file?.path || '';
  const content = file?.content || '';
  const ext = (path.split('.').pop() || '').toLowerCase();
  const tests = [];

  tests.push(
    test(
      'step_non_empty',
      content.trim().length > 15,
      content.trim().length > 15 ? 'content present' : 'file is empty or too short',
      'critical',
    ),
  );

  tests.push(
    test(
      'step_path_valid',
      /^src\/(components|generated|io|views)\/[\w.-]+\.(tsx|ts|py|jsx|js)$/i.test(path) || path === 'src/AppShell.tsx',
      path ? `path ${path}` : 'missing file path',
      'critical',
    ),
  );

  tests.push(
    test('step_no_markdown_fences', !content.includes('```'), 'no markdown fences in output', 'high'),
  );

  const syntax = validateSyntax(content, ext === 'py' ? 'py' : ext.includes('tsx') ? 'tsx' : 'ts');
  tests.push(
    test(
      'step_syntax',
      syntax.ok,
      syntax.ok ? 'syntax checks passed' : syntax.issues.join('; '),
      'critical',
    ),
  );

  if (ext === 'py') {
    tests.push(
      test(
        'step_py_not_react',
        !isReactContent(content),
        isReactContent(content) ? 'Python file contains React/JSX' : 'Python content OK',
        'critical',
      ),
    );
    if (path.includes('stl_export')) {
      tests.push(
        test(
          'step_stl_build123d',
          /build123d|cadquery|export_stl/i.test(content),
          /build123d|cadquery|export_stl/i.test(content)
            ? 'STL export uses CAD library'
            : 'STL export missing build123d/cadquery',
          'high',
        ),
      );
    }
  }

  if (ext === 'ts' || ext === 'tsx') {
    const pythonInTs = isPythonContent(content) && !isReactContent(content);
    tests.push(
      test(
        'step_ts_not_python',
        !pythonInTs,
        pythonInTs
          ? `${path} is TypeScript but looks like Python`
          : 'TypeScript content OK (no Python syntax)',
        'critical',
      ),
    );

    const dupes = findDuplicateExports(content);
    tests.push(
      test(
        'step_single_export',
        dupes.length === 0,
        dupes.length ? `duplicate exports: ${dupes.join(', ')}` : 'single export per symbol',
        'critical',
      ),
    );
    tests.push(
      test(
        'step_has_export',
        /export\s/.test(content),
        /export\s/.test(content) ? 'export found' : 'no export statement',
        'high',
      ),
    );
  }

  const expectedExt = pickExtension(node, content, domain);
  const pathExt = ext === 'jsx' ? 'tsx' : ext;
  const expectedNorm = expectedExt === 'jsx' ? 'tsx' : expectedExt;
  const extMatch =
    pathExt === expectedNorm || (pathExt === 'ts' && expectedNorm === 'tsx');
  const crossLang =
    (ext === 'ts' || ext === 'tsx') && isPythonContent(content) && !isReactContent(content);
  tests.push(
    test(
      'step_extension_match',
      extMatch,
      extMatch
        ? `path .${pathExt} matches content (expected .${expectedNorm})`
        : `path .${pathExt} does not match content (expected .${expectedNorm})`,
      crossLang ? 'critical' : 'high',
    ),
  );

  if (domain === 'cad-stl' && /viewport|3d/i.test(path)) {
    const badLib = WRONG_CAD_LIBS.find((w) => w.pattern.test(content));
    tests.push(
      test(
        'step_cad_no_map_lib',
        !badLib,
        badLib ? `wrong library ${badLib.lib} for CAD viewport` : 'no map/geospatial libs',
        'high',
      ),
    );
    tests.push(
      test(
        'step_cad_3d_stack',
        /@react-three|three|Canvas/i.test(content) || content.length < 120,
        /@react-three|three|Canvas/i.test(content)
          ? 'uses react-three-fiber / Three.js'
          : 'viewport missing 3D stack (warn if stub)',
        'medium',
      ),
    );
  }

  if (path.includes('/components/') && node.type === 'ui') {
    tests.push(
      test(
        'step_ui_not_empty',
        content.length >= 180 || /useState|useEffect|Monaco|textarea|Canvas|onChange/i.test(content),
        content.length >= 180 ? 'UI component has substance' : 'UI shell may be too empty',
        'medium',
      ),
    );
  }

  if (path === 'src/AppShell.tsx') {
    tests.push(
      test(
        'step_appshell_layout',
        /export function AppShell|className="app-root"/.test(content),
        'AppShell exports root layout',
        'high',
      ),
    );
  }

  if (file?.manifestEntry?.validationRules?.length) {
    const manifestActions = context.manifestActions || [];
    const meta = {
      ...file.manifestEntry,
      manifestActions,
      actions: manifestActions.filter((a) => a.ownerId === file.taskId),
    };
    const ruleTests = runManifestValidationRules(content, meta);
    tests.push(...ruleTests);
  }

  const issues = tests.filter((t) => !t.pass);
  const criticalFail = issues.some((t) => t.severity === 'critical');
  return {
    ok: !criticalFail,
    taskId,
    path,
    tests,
    issues,
    passed: tests.filter((t) => t.pass).length,
    failed: issues.length,
  };
}

/**
 * Format step test lines for build console logs.
 */
export function formatStepTestLog(result) {
  return result.tests.map((t) => ({
    level: t.pass ? 'success' : t.severity === 'critical' ? 'error' : 'warn',
    message: `TEST ${t.pass ? 'PASS' : 'FAIL'} [${t.id}] ${t.message}`,
  }));
}
