/**
 * Post-generation verification — extension mismatch, duplicate exports,
 * wrong libraries, empty shells, parameter file sprawl.
 */

import { computeFidelityAxes } from './fidelity-axes.js';

const WRONG_CAD_LIBS = [
  { pattern: /@deck\.gl/i, lib: '@deck.gl', fix: '@react-three/fiber' },
  { pattern: /from ['"]mapbox-gl/i, lib: 'mapbox-gl', fix: '@react-three/fiber' },
];

export function detectParamSprawl(files = []) {
  const groups = {};
  for (const file of files) {
    const path = file.path || '';
    if (!path.startsWith('src/generated/')) continue;
    const base = path.split('/').pop().replace(/\.[^.]+$/, '');
    const prefix = getParamPrefix(base);
    if (!prefix || base === prefix) continue;
    if (!isTinyParamFile(file.content)) continue;
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(path);
  }

  const result = Object.entries(groups)
    .filter(([, paths]) => paths.length >= 3)
    .map(([prefix, paths]) => ({ prefix, files: paths }));

  return { groups: result };
}

function getParamPrefix(base) {
  const known = ['wheel_part', 'stator_ring', 'project_settings'];
  for (const p of known) {
    if (base === p) return null;
    if (base.startsWith(`${p}_`)) return p;
  }
  const parts = base.split('_');
  if (parts.length >= 3) return parts.slice(0, 2).join('_');
  if (parts.length >= 2) return parts[0];
  return null;
}

function isTinyParamFile(content = '') {
  const lines = content.trim().split('\n').filter(Boolean);
  return content.length < 280 && lines.length <= 8;
}

function isReactContent(content = '') {
  return /import\s+React|from\s+['"]react['"]|export\s+const\s+\w+\s*=\s*\(\)/.test(content);
}

function isPythonContent(content = '') {
  const t = content.trim();
  if (isReactContent(content)) return false;
  if (/^(import |from )/m.test(t)) return true;
  if (/^\w+\s*=\s*\{/.test(t)) return true;
  if (/^def\s+\w+/m.test(t)) return true;
  return false;
}

export function findDuplicateExports(content = '') {
  const names = [];
  const re = /export\s+(?:const|function|class)\s+(\w+)/g;
  let m;
  while ((m = re.exec(content)) !== null) names.push(m[1]);
  const seen = new Set();
  const dupes = [];
  for (const n of names) {
    if (seen.has(n)) dupes.push(n);
    seen.add(n);
  }
  return [...new Set(dupes)];
}

export function verifyScaffold(files = [], domain = 'app-ui') {
  const issues = [];

  for (const file of files) {
    const path = file.path || '';
    const content = file.content || '';
    const ext = (path.split('.').pop() || '').toLowerCase();

    if (ext === 'py' && isReactContent(content)) {
      issues.push({
        severity: 'critical',
        code: 'EXT_MISMATCH',
        path,
        message: `${path} is .py but contains React/JSX`,
        repair: 'fix_stl_io',
      });
    }

    if ((ext === 'ts' || ext === 'tsx') && isPythonContent(content) && !isReactContent(content)) {
      issues.push({
        severity: 'high',
        code: 'EXT_MISMATCH',
        path,
        message: `${path} is TypeScript but looks like Python`,
        repair: 'regenerate_file',
      });
    }

    const dupes = findDuplicateExports(content);
    if (dupes.length) {
      issues.push({
        severity: 'critical',
        code: 'DUPLICATE_EXPORT',
        path,
        message: `Duplicate exports in ${path}: ${dupes.join(', ')}`,
        repair: 'regenerate_file',
      });
    }

    if (domain === 'cad-stl' && /viewport|3d/i.test(path)) {
      for (const { pattern, lib, fix } of WRONG_CAD_LIBS) {
        if (pattern.test(content)) {
          issues.push({
            severity: 'high',
            code: 'WRONG_LIBRARY',
            path,
            message: `${path} uses ${lib} — use ${fix} for CAD 3D viewport`,
            repair: 'regenerate_viewport_r3f',
          });
        }
      }
      if (!/@react-three|three|Canvas|useGLTF/i.test(content) && content.length > 100) {
        issues.push({
          severity: 'medium',
          code: 'MISSING_3D_STACK',
          path,
          message: `${path} has no react-three-fiber / Three.js usage for CAD viewport`,
          repair: 'regenerate_viewport_r3f',
        });
      }
    }

    if (
      path.includes('/components/') &&
      content.length < 220 &&
      !/useState|useEffect|Monaco|textarea|onChange/i.test(content)
    ) {
      issues.push({
        severity: 'medium',
        code: 'EMPTY_SHELL',
        path,
        message: `${path} is an empty UI shell`,
        repair: 'regenerate_ui',
      });
    }
  }

  const sprawl = detectParamSprawl(files);
  for (const group of sprawl.groups) {
    issues.push({
      severity: 'medium',
      code: 'PARAM_SPRAWL',
      paths: group.files,
      prefix: group.prefix,
      message: `${group.prefix}: ${group.files.length} tiny param files — should be one config module`,
      repair: 'consolidate_params',
    });
  }

  const critical = issues.filter((i) => i.severity === 'critical').length;
  const high = issues.filter((i) => i.severity === 'high').length;
  const medium = issues.filter((i) => i.severity === 'medium').length;
  const compileScore = Math.max(0, 100 - critical * 30 - high * 15 - medium * 5);

  return {
    ok: critical === 0,
    issues,
    compileScore,
    counts: { critical, high, medium, total: issues.length },
  };
}

export function computeHonestFidelity(structureFidelity, verification, generatedFiles = [], manifest = null) {
  const compileScore = verification?.compileScore ?? 0;
  let axes = structureFidelity?.axes;

  if (manifest?.views?.length) {
    axes = computeFidelityAxes(manifest, generatedFiles);
  }

  const structureScore = axes?.structure?.score ?? structureFidelity?.score ?? 0;
  const wiringScore = axes?.wiring?.score;
  const fieldScore = axes?.fields?.score;

  const scores = [structureScore, compileScore];
  if (wiringScore != null) scores.push(wiringScore);
  if (fieldScore != null) scores.push(fieldScore);
  const score = Math.round(Math.min(...scores));

  return {
    score,
    structureScore,
    wiringScore,
    fieldScore,
    compileScore,
    axes,
    hits: axes?.structure?.hits ?? structureFidelity?.hits,
    total: axes?.structure?.total ?? structureFidelity?.total,
    nodes: structureFidelity?.nodes,
    issueCount: verification?.counts?.total ?? 0,
  };
}
