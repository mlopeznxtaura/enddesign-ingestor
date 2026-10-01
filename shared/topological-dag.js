/**
 * Stage 2 — Topological DAG: anatomy nodes → dependency graph + topo order.
 */

import { VIEW_TYPES, viewPathFor } from './view-classify.js';

const VIEW_TEMPLATE_MAP = {
  [VIEW_TYPES.INGEST]: 'react_view_ingest',
  [VIEW_TYPES.DAG]: 'react_view_dag',
  [VIEW_TYPES.DERIVED]: 'react_view_derived',
  [VIEW_TYPES.VIEWPORT]: 'react_viewport_r3f',
  [VIEW_TYPES.CODE_EDITOR]: 'react_code_editor',
  [VIEW_TYPES.TOP_BAR]: 'react_view_top_bar',
  [VIEW_TYPES.PARAM_PANEL]: 'react_ui_panel',
  [VIEW_TYPES.SIDEBAR]: 'react_view_nav_list',
  [VIEW_TYPES.NAV_LIST]: 'react_view_nav_list',
  [VIEW_TYPES.KANBAN]: 'react_view_kanban',
  [VIEW_TYPES.MAIN_PANEL]: 'react_view_kanban',
  [VIEW_TYPES.RIGHT_PANEL]: 'react_view_detail',
  [VIEW_TYPES.MODAL]: 'react_view_modal_form',
  [VIEW_TYPES.GENERIC]: 'react_view_generic',
};

/**
 * @param {object} anatomy - from structureToAnatomy
 * @returns {{ nodes: Array, edges: Array, topoOrder: string[] }}
 */
export function anatomyToTopologicalDAG(anatomy = {}) {
  const nodes = [];
  const edges = [];
  const domain = anatomy.domain || 'app-ui';

  const partIds = anatomy.nodes.filter((n) => n.kind === 'part_group').map((n) => n.id);
  const viewNodes = anatomy.nodes.filter((n) => n.kind === 'ui_view');
  const actionNodes = anatomy.nodes.filter((n) => n.kind === 'action_button');
  const schemaNodes = anatomy.nodes.filter((n) => n.kind === 'form_schema');

  const viewIds = viewNodes.map((n) => n.id);
  const viewRegions = Object.fromEntries(viewNodes.map((v) => [v.id, v.region || 'center']));

  for (const n of anatomy.nodes) {
    if (n.kind === 'form_schema') {
      nodes.push({
        id: n.id,
        name: n.name,
        type: 'fn',
        kind: 'form_schema',
        desc: `Schema: ${n.schemaName || n.name}`,
        layer: 'fn',
        templateType: 'ts_schema',
        requires: [],
        provides: [`${n.id}`],
        fields: n.fields || [],
        schemaName: n.schemaName || 'FormSchema',
      });
    } else if (n.kind === 'part_group') {
      nodes.push({
        id: n.id,
        name: n.name,
        type: 'fn',
        kind: 'part_config',
        desc: `Config for ${n.name}`,
        params: n.elements || [],
        layer: 'fn',
        templateType: 'ts_config',
        requires: [],
        provides: [`${n.id}_config`],
      });
    } else if (n.kind === 'action_button') {
      const parentView = n.parentView || null;
      nodes.push({
        id: n.id,
        name: n.name,
        type: 'fn',
        kind: 'action_handler',
        desc: `Action: ${n.name}`,
        layer: 'fn',
        action: true,
        templateType: 'ts_action_handler',
        requires: [...partIds.map((p) => `${p}_config`), ...schemaNodes.map((s) => s.id)],
        provides: [`action_${n.id}`],
        parentView,
        ownerId: parentView,
        embeddedInView: n.embeddedInView || Boolean(parentView),
        buttonId: n.buttonId || n.id,
        dataAction: n.dataAction || n.id,
      });
      for (const pid of partIds) {
        edges.push({ from: pid, to: n.id, kind: 'config_to_action' });
      }
      if (parentView) {
        edges.push({ from: n.id, to: parentView, kind: 'action_to_view' });
      }
    } else if (n.kind === 'ui_view') {
      const viewType = n.viewType || VIEW_TYPES.GENERIC;
      const templateType = n.templateType || VIEW_TEMPLATE_MAP[viewType] || 'react_view_generic';
      const childIds = (n.childActions || []).map((a) => a.id);
      const actionRequires = childIds.map((id) => `action_${id}`);
      const configRequires = partIds.map((p) => `${p}_config`);
      const schemaRequires = n.fields?.length ? schemaNodes.map((s) => s.id) : [];

      nodes.push({
        id: n.id,
        name: n.name,
        type: 'ui',
        kind: 'ui_view',
        viewType,
        classification: 'UI_VIEW',
        desc: `View: ${n.name}`,
        layer: 'ui',
        templateType,
        region: n.region,
        requires: [...configRequires, ...schemaRequires, ...actionRequires],
        provides: [`view_${n.id}`],
        params: n.elements || n.fields || [],
        fields: n.fields || [],
        elements: n.elements || [],
        columns: n.columns || [],
        childActions: n.childActions || [],
        actionRefs: childIds,
        snippet: n.snippet || '',
        viewPath: viewPathFor(viewType, n.id),
      });

      for (const cid of childIds) {
        if (actionNodes.some((a) => a.id === cid)) {
          edges.push({ from: cid, to: n.id, kind: 'handler_to_view' });
        }
      }
      for (const pid of partIds) {
        if (viewType === VIEW_TYPES.PARAM_PANEL || n.id.includes(pid)) {
          edges.push({ from: pid, to: n.id, kind: 'config_to_view' });
        }
      }
      for (const sid of schemaRequires) {
        edges.push({ from: sid, to: n.id, kind: 'schema_to_view' });
      }
    } else if (n.kind === 'stl_output') {
      nodes.push({
        id: n.id,
        name: n.name,
        type: 'io',
        kind: 'stl_export',
        desc: 'STL export (build123d)',
        layer: 'io',
        templateType: 'python_stl_export',
        requires: [...partIds.map((p) => `${p}_config`)],
        provides: ['stl_file'],
      });
      for (const pid of partIds) {
        edges.push({ from: pid, to: n.id, kind: 'config_to_io' });
      }
    }
  }

  if (viewIds.length) {
    nodes.push({
      id: 'app_shell',
      name: 'App Shell',
      type: 'root',
      kind: 'app_shell',
      desc: 'Grid layout shell wiring all views',
      layer: 'root',
      templateType: 'react_app_shell',
      requires: viewIds.map((id) => `view_${id}`),
      provides: ['app_shell'],
      viewIds,
      viewTypes: Object.fromEntries(viewNodes.map((v) => [v.id, v.viewType])),
      viewRegions,
    });
    for (const vid of viewIds) {
      edges.push({ from: vid, to: 'app_shell', kind: 'view_to_shell' });
    }
  }

  const topoOrder = topologicalSort(nodes, edges);

  return {
    version: '1.2',
    stage: 'topological-dag',
    domain,
    appTitle: anatomy.appTitle,
    nodes,
    edges,
    topoOrder,
  };
}

function topologicalSort(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const inDegree = Object.fromEntries(ids.map((id) => [id, 0]));
  const adj = Object.fromEntries(ids.map((id) => [id, []]));

  for (const e of edges) {
    if (!adj[e.from]) adj[e.from] = [];
    if (ids.includes(e.from) && ids.includes(e.to)) {
      adj[e.from].push(e.to);
      inDegree[e.to] += 1;
    }
  }

  const queue = ids.filter((id) => inDegree[id] === 0);
  const order = [];

  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adj[id] || []) {
      inDegree[next] -= 1;
      if (inDegree[next] === 0) queue.push(next);
    }
  }

  const remaining = ids.filter((id) => !order.includes(id));
  return [...order, ...remaining];
}

/**
 * Convert topological DAG back to layers format for UI compatibility.
 */
export function dagToLayers(dag) {
  const ui = dag.nodes.filter((n) => n.layer === 'ui');
  const fn = dag.nodes.filter((n) => n.layer === 'fn');
  const io = dag.nodes.filter((n) => n.layer === 'io');
  const layers = [];
  if (ui.length) layers.push({ label: 'UI / Views', nodes: ui });
  if (fn.length) layers.push({ label: 'Functions / Handlers', nodes: fn });
  if (io.length) layers.push({ label: 'I/O / Artifacts', nodes: io });
  const root = dag.nodes.find((n) => n.kind === 'app_shell') || {
    id: slugify(dag.appTitle || 'app_root'),
    name: dag.appTitle || 'App',
    type: 'root',
    layer: 'root',
    edges: fn.map((n) => n.id),
  };
  layers.push({ label: 'Root Capability', nodes: [root] });
  return layers;
}

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}
