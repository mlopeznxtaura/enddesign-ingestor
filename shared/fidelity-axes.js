/**
 * Three-axis honest fidelity — structure / wiring / fields.
 */

import { viewPathFor } from './view-classify.js';

function pct(hits, total) {
  if (!total) return null;
  return Math.round((hits / total) * 100);
}

function confirmedImportAndCallSite(files, action, viewFiles) {
  const fn = action.fnName;
  const ownerFile = files.find((f) => f.taskId === action.ownerId);
  const searchFiles = ownerFile ? [ownerFile] : viewFiles;
  return searchFiles.some(
    (f) =>
      f.content?.includes(`import { ${fn}`) &&
      (f.content?.includes(`${fn}()`) || f.content?.includes(`${fn}(`)),
  );
}

function fieldPresentInGenerated(files, fieldName) {
  return files.some((f) => f.content?.includes(fieldName));
}

/**
 * @param {object} sourceManifest - manifest with views[] and actions[]
 * @param {object[]} generatedFiles - agentBuild.files
 */
export function computeFidelityAxes(sourceManifest, generatedFiles = []) {
  const views = sourceManifest?.views || [];
  if (!views.length) {
    return {
      refuseScore: true,
      error: 'NO_SOURCE_VIEWS',
      structure: { hits: 0, total: 0, score: 0 },
      wiring: { hits: 0, total: 0, score: null },
      fields: { hits: 0, total: 0, score: null },
      overall: 0,
    };
  }

  const viewFiles = generatedFiles.filter((f) => f.path?.startsWith('src/views/'));
  const matchedContainers = views.filter((v) => {
    const path = `src/views/${v.id.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}.tsx`;
    const byTask = generatedFiles.find((f) => f.taskId === v.id && /\.tsx$/i.test(f.path));
    const byPath = generatedFiles.find(
      (f) =>
        f.path?.endsWith('.tsx') &&
        f.path.includes(v.id.replace(/_/g, '')) ||
        f.path === viewPathFor(v.viewType, v.id),
    );
    const file = byTask || byPath;
    return file && file.templateType !== 'react_view_fallback_passthrough';
  }).length;

  // More reliable: match by taskId
  const matchedByTask = views.filter((v) =>
    generatedFiles.some(
      (f) =>
        f.taskId === v.id &&
        /\.tsx$/i.test(f.path) &&
        f.templateType !== 'react_view_fallback_passthrough',
    ),
  ).length;

  const actions = sourceManifest?.actions || [];
  const boundActions = actions.filter((a) =>
    confirmedImportAndCallSite(generatedFiles, a, viewFiles),
  ).length;

  const fields = views.flatMap((v) => v.fields || []);
  const presentFields = fields.filter((f) =>
    fieldPresentInGenerated(generatedFiles, f.name || f.id),
  ).length;

  const structureScore = pct(matchedByTask, views.length) ?? 0;
  const wiringScore = actions.length ? pct(boundActions, actions.length) : null;
  const fieldScore = fields.length ? pct(presentFields, fields.length) : null;

  const scores = [structureScore];
  if (wiringScore != null) scores.push(wiringScore);
  if (fieldScore != null) scores.push(fieldScore);
  const overall = Math.min(...scores);

  return {
    refuseScore: false,
    structure: { hits: matchedByTask, total: views.length, score: structureScore },
    wiring: {
      hits: boundActions,
      total: actions.length,
      score: wiringScore,
    },
    fields: {
      hits: presentFields,
      total: fields.length,
      score: fieldScore,
    },
    overall,
    hits: matchedByTask,
    total: views.length,
    score: overall,
    kind: 'axes',
  };
}

/**
 * Ingest-time layout coverage from structure tree (before build).
 */
export function computeIngestLayoutCoverage(structure, manifest) {
  const sourceViews = structure?.views?.length || manifest?.views?.length || 0;
  const manifestViews = manifest?.views?.length || 0;
  const viewFiles = (manifest?.files || []).filter(
    (f) => f.kind === 'ui_view' || f.templateType?.startsWith('react_view'),
  ).length;

  if (!sourceViews) {
    return { hits: 0, total: 0, score: 0, refuseScore: true };
  }

  const hits = Math.min(manifestViews || viewFiles, sourceViews);
  return {
    hits,
    total: sourceViews,
    score: Math.round((hits / sourceViews) * 100),
    refuseScore: false,
  };
}
