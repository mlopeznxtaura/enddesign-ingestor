/**
 * Stage 3 — Manifest "Knower": file tree + validation rules before code is written.
 */

import { filePathForNode } from './codegen-utils.js';
import { viewPathFor, viewComponentName } from './view-classify.js';

function paramKeyFromLabel(label = '') {
  return label
    .replace(/\([^)]*\)/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '');
}

function defaultValidationRules(manifestEntry) {
  const rules = [
    { id: 'non_empty', severity: 'critical', expect: 'content.length > 15' },
    { id: 'no_markdown', severity: 'high', expect: 'no ``` fences' },
  ];

  const ext = (manifestEntry.path?.split('.').pop() || '').toLowerCase();
  if (ext === 'py') {
    rules.push({ id: 'python_only', severity: 'critical', expect: 'no React/JSX' });
    if (manifestEntry.path?.includes('stl_export')) {
      rules.push({ id: 'build123d', severity: 'high', expect: 'build123d or export_stl' });
    }
  }
  if (ext === 'ts' || ext === 'tsx') {
    rules.push({ id: 'typescript_only', severity: 'critical', expect: 'no Python dict/def syntax' });
    rules.push({ id: 'single_export', severity: 'critical', expect: 'one export per symbol' });
    rules.push({ id: 'has_export', severity: 'high', expect: 'export statement present' });
  }
  if (manifestEntry.templateType === 'ts_config') {
    rules.push({
      id: 'config_keys',
      severity: 'high',
      expect: `exports ${manifestEntry.configPrefix}Defaults with typed keys`,
      keys: manifestEntry.configKeys || [],
    });
  }
  if (manifestEntry.templateType === 'ts_schema') {
    rules.push({
      id: 'schema_fields',
      severity: 'high',
      expect: 'exports interface with field keys',
      fields: manifestEntry.fields || [],
    });
  }
  if (manifestEntry.templateType === 'react_ui_panel') {
    rules.push({
      id: 'ui_bindings',
      severity: 'medium',
      expect: 'useState and input onChange handlers',
    });
  }
  if (manifestEntry.templateType === 'react_viewport_r3f') {
    rules.push({
      id: 'r3f_stack',
      severity: 'high',
      expect: '@react-three/fiber Canvas — not deck.gl',
    });
  }

  if (manifestEntry.templateType?.startsWith('react_view') || manifestEntry.templateType === 'react_app_shell') {
    rules.push({
      id: 'view_layout',
      severity: 'high',
      expect: 'React section with className layout region',
    });
  }
  if (manifestEntry.templateType === 'react_view_top_bar') {
    rules.push({
      id: 'view_imports_handlers',
      severity: 'high',
      expect: 'imports action handlers for toolbar buttons',
    });
  }
  const actionCount =
    manifestEntry.actionRefs?.length || manifestEntry.childActions?.length || 0;
  if (
    manifestEntry.templateType?.startsWith('react_view') &&
    manifestEntry.templateType !== 'react_view_top_bar' &&
    actionCount > 0
  ) {
    rules.push({
      id: 'view_imports_handlers',
      severity: 'high',
      expect: 'imports action handlers for view buttons',
    });
  }

  return rules;
}

/**
 * @param {object} dag - from anatomyToTopologicalDAG
 * @returns {object} scaffold manifest
 */
export function buildScaffoldManifest(dag = {}) {
  const domain = dag.domain || 'app-ui';
  const files = [];

  for (const node of dag.nodes || []) {
    const pseudoContent = placeholderForTemplate(node);
    const path = manifestPathForNode(node, pseudoContent, domain);
    const ext = path.split('.').pop();

    let configKeys = [];
    let configPrefix = node.id;
    if (node.templateType === 'ts_config' && node.params?.length) {
      configKeys = node.params.map((p) =>
        p.id?.split('_').pop() || paramKeyFromLabel(p.label || ''),
      );
    }

    const entry = {
      taskId: node.id,
      path,
      name: path.split('/').pop(),
      type: node.type,
      kind: node.kind,
      templateType: node.templateType,
      language: ext === 'py' ? 'python' : ext === 'tsx' ? 'typescript/react' : 'typescript',
      deterministic: Boolean(node.templateType),
      requires: node.requires || [],
      provides: node.provides || [],
      desc: node.desc || node.name,
      configPrefix,
      configKeys,
      params: node.params || [],
      snippet: node.snippet || '',
      viewType: node.viewType,
      region: node.region,
      childActions: node.childActions || [],
      actionRefs: node.actionRefs || [],
      fields: node.fields || [],
      elements: node.elements || [],
      columns: node.columns || [],
      viewIds: node.viewIds || [],
      viewTypes: node.viewTypes || {},
      viewRegions: node.viewRegions || {},
      viewPath: node.viewPath,
      schemaName: node.schemaName,
      validationRules: defaultValidationRules({
        path,
        templateType: node.templateType,
        configPrefix,
        configKeys,
        fields: node.fields,
        schemaName: node.schemaName,
        actionRefs: node.actionRefs,
        childActions: node.childActions,
      }),
    };
    files.push(entry);
  }

  const executionOrder = dag.topoOrder?.length
    ? dag.topoOrder.filter((id) => files.some((f) => f.taskId === id))
    : files.map((f) => f.taskId);

  return {
    version: '2.0',
    stage: 'manifest',
    pipeline: 'anatomy-first-v3',
    generated: new Date().toISOString(),
    domain,
    appTitle: dag.appTitle,
    executionOrder,
    files,
    meta: {
      totalFiles: files.length,
      deterministicFiles: files.filter((f) => f.deterministic).length,
      llmOptional: false,
    },
  };
}

function manifestPathForNode(node, content, domain) {
  if (node.templateType === 'ts_config') {
    return `src/generated/${node.id}_config.ts`;
  }
  if (node.templateType === 'ts_schema') {
    const name = node.schemaName || 'FormSchema';
    return `src/generated/${name}.ts`;
  }
  if (node.templateType === 'python_stl_export') {
    return 'src/io/stl_export.py';
  }
  if (node.templateType === 'ts_action_handler') {
    return `src/generated/${node.id}_handler.ts`;
  }
  if (node.kind === 'ui_view' || node.templateType?.startsWith('react_view')) {
    return node.viewPath || viewPathFor(node.viewType, node.id);
  }
  if (node.templateType === 'react_app_shell') {
    return 'src/AppShell.tsx';
  }
  return filePathForNode(node, content, domain);
}

function placeholderForTemplate(node) {
  if (node.templateType === 'python_stl_export') return 'from build123d import *\n';
  if (node.templateType?.startsWith('react')) return 'import React from "react";\nexport function X() { return <div/>; }\n';
  if (node.templateType === 'ts_config') return 'export const x = {};\n';
  return 'export const x = 1;\n';
}

/**
 * Attach manifest to task plan shape.
 */
export function manifestToTaskPlan(manifest) {
  const tasks = manifest.executionOrder.map((taskId) => {
    const f = manifest.files.find((x) => x.taskId === taskId);
    return {
      id: taskId,
      name: f?.desc || taskId,
      desc: f?.desc || '',
      type: f?.type || 'fn',
      kind: f?.kind,
      status: 'pending',
      templateType: f?.templateType,
      deterministic: f?.deterministic,
      validationRules: f?.validationRules,
      params: f?.params || [],
      viewType: f?.viewType,
      childActions: f?.childActions || [],
      domain: manifest.domain,
    };
  });

  return {
    version: '2.0',
    generated: manifest.generated,
    meta: {
      root: slugify(manifest.appTitle),
      rootName: manifest.appTitle,
      domain: manifest.domain,
      pipeline: manifest.pipeline,
      loopActive: false,
      completedAt: null,
    },
    manifest,
    tasks,
  };
}

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}
