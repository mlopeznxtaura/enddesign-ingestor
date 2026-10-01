/**
 * Stage 1 — Visual Anatomist: structure → hierarchical UI anatomy JSON.
 */

import { VIEW_TYPES } from './view-classify.js';

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}

/**
 * @param {object} structure - extractHTMLStructure / vision output
 * @returns {object} anatomy document
 */
export function structureToAnatomy(structure = {}) {
  const nodes = [];
  let order = 0;

  for (const view of structure.views || []) {
    nodes.push({
      id: view.id,
      kind: 'ui_view',
      viewType: view.viewType || VIEW_TYPES.GENERIC,
      name: view.name,
      hierarchy: 'layout',
      classification: 'UI_VIEW',
      order: order++,
      region: view.region,
      templateType: view.templateType,
      childActions: view.actions || [],
      fields: view.fields || [],
      elements: view.elements || [],
      columns: view.columns || [],
      snippet: view.htmlHint || '',
    });
  }

  for (const col of structure.columns || []) {
    if (nodes.some((n) => n.id === col.id)) continue;
    nodes.push({
      id: col.id,
      kind: 'ui_view',
      viewType: col.type === 'panel' ? VIEW_TYPES.PARAM_PANEL : VIEW_TYPES.GENERIC,
      name: col.name,
      hierarchy: 'layout',
      classification: 'UI_VIEW',
      order: order++,
      region: col.source || 'html',
      childActions: [],
    });
  }

  for (const part of structure.parts || []) {
    const elements = (part.params || []).map((p) => ({
      type: 'input_box',
      id: p.id,
      label: p.label,
      data_type: inferDataType(p.label, p.value),
      default: p.value || '',
    }));
    nodes.push({
      id: part.id,
      kind: 'part_group',
      name: part.name,
      hierarchy: 'functions',
      order: order++,
      elements,
    });
  }

  for (const act of structure.actions || []) {
    nodes.push({
      id: act.id,
      kind: 'action_button',
      name: act.name,
      hierarchy: 'actions',
      classification: 'ACTION_BUTTON',
      order: order++,
      actionType: act.type || 'button',
      buttonId: act.buttonId || act.id,
      parentView: act.parentView || null,
    });
  }

  for (const view of structure.views || []) {
    for (const act of view.actions || []) {
      if (nodes.some((n) => n.kind === 'action_button' && n.id === act.id)) continue;
      nodes.push({
        id: act.id,
        kind: 'action_button',
        name: act.name,
        hierarchy: 'actions',
        classification: 'ACTION_BUTTON',
        order: order++,
        actionType: 'button',
        buttonId: act.buttonId || act.id,
        dataAction: act.dataAction || act.id,
        parentView: view.id,
        embeddedInView: true,
      });
    }
  }

  // Schema node when modal/form fields present
  const allFields = (structure.views || []).flatMap((v) =>
    (v.fields || []).map((f) => ({ ...f, viewId: v.id })),
  );
  if (allFields.length) {
    const schemaId = structure.domain === 'crm-pipeline' ? 'lead' : 'form';
    nodes.push({
      id: `${schemaId}_schema`,
      kind: 'form_schema',
      name: `${schemaId} Schema`,
      hierarchy: 'data',
      order: order++,
      fields: allFields,
      schemaName: schemaId === 'lead' ? 'LeadSchema' : 'FormSchema',
    });
  }

  if (structure.codeSnippet) {
    const hasCodeView = nodes.some((n) => n.viewType === VIEW_TYPES.CODE_EDITOR);
    if (!hasCodeView) {
      nodes.push({
        id: 'code_editor',
        kind: 'ui_view',
        viewType: VIEW_TYPES.CODE_EDITOR,
        name: 'Code Editor',
        hierarchy: 'io',
        classification: 'UI_VIEW',
        order: order++,
        snippet: structure.codeSnippet.slice(0, 2000),
        childActions: [],
      });
    }
  }

  if (structure.domain === 'cad-stl') {
    const hasViewport = nodes.some((n) => n.viewType === VIEW_TYPES.VIEWPORT);
    if (!hasViewport) {
      nodes.push({
        id: 'center_viewport',
        kind: 'ui_view',
        viewType: VIEW_TYPES.VIEWPORT,
        name: '3D Viewport',
        hierarchy: 'layout',
        classification: 'UI_VIEW',
        order: order++,
        childActions: [],
      });
    }
    nodes.push({
      id: 'stl_export',
      kind: 'stl_output',
      name: 'STL Export',
      hierarchy: 'io',
      order: order++,
    });
  }

  return {
    version: '1.1',
    stage: 'anatomy',
    appTitle: structure.appTitle || 'App',
    domain: structure.domain || 'app-ui',
    nodes,
    confidence: structure.confidence ?? 0.8,
    source: structure.source || 'html-structure',
  };
}

function inferDataType(label = '', value = '') {
  const l = label.toLowerCase();
  if (l.includes('material') || l.includes('units') || l.includes('name')) return 'string';
  if (/^\d+(\.\d+)?$/.test(String(value).trim())) return 'float';
  return 'string';
}

export { slugify };
