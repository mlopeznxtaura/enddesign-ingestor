/**
 * Anatomy-First pipeline orchestrator (Stages 1–3).
 */

import { structureToAnatomy } from './anatomy.js';
import { anatomyToTopologicalDAG, dagToLayers } from './topological-dag.js';
import { buildScaffoldManifest, manifestToTaskPlan } from './manifest-knower.js';
import { buildManifestTree, enrichManifestWithTree } from './manifest-tree.js';
import { preflightTemplateCoverage } from './template-registry.js';
import { computeIngestLayoutCoverage } from './fidelity-axes.js';

/**
 * Run full planning pipeline: structure → anatomy → DAG → manifest → taskPlan.
 * @param {object} structure - from extractHTMLStructure / vision
 * @param {{ strictMode?: boolean }} options
 * @returns {object}
 */
export function runAnatomyPipeline(structure, options = {}) {
  const anatomy = structureToAnatomy(structure);
  const dag = anatomyToTopologicalDAG(anatomy);
  let manifest = buildScaffoldManifest(dag);
  const tree = buildManifestTree(structure);
  manifest = enrichManifestWithTree(manifest, tree);

  const preflightFlags = preflightTemplateCoverage(manifest, {
    strictMode: options.strictMode ?? false,
  });

  const taskPlan = manifestToTaskPlan(manifest);
  const layers = dagToLayers(dag);
  const layoutCoverage = computeIngestLayoutCoverage(structure, manifest);

  return {
    anatomy,
    dag,
    manifest,
    taskPlan,
    layers,
    pipeline: 'anatomy-first-v3',
    preflightFlags,
    layoutCoverage,
    stats: {
      anatomyNodes: anatomy.nodes.length,
      dagNodes: dag.nodes.length,
      manifestFiles: manifest.files.length,
      deterministicFiles: manifest.meta.deterministicFiles,
      executionOrder: manifest.executionOrder.length,
      sourceViews: tree.views.length,
      sourceActions: tree.actions.length,
      layoutCoverage,
    },
  };
}

export { structureToAnatomy } from './anatomy.js';
export { anatomyToTopologicalDAG, dagToLayers } from './topological-dag.js';
export { buildScaffoldManifest, manifestToTaskPlan } from './manifest-knower.js';
