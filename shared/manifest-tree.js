/**
 * Bidirectional manifest tree — views[].actionRefs + actions[].ownerId
 */

import {
  VIEW_TYPES,
  actionFnName,
  actionImportPath,
  regionForViewType,
  templateTypeForView,
} from './view-classify.js';

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}

function actionRecord(act, ownerId) {
  const id = act.id;
  const dataAction = act.dataAction || act.buttonId || id;
  return {
    id,
    ownerId,
    name: act.name || id,
    fnName: actionFnName(id),
    importPath: actionImportPath(id),
    bindingProp: 'onClick',
    buttonSelector: `data-action="${dataAction}"`,
    dataAction,
  };
}

/**
 * Build hierarchical views[] and actions[] from extracted structure.
 */
export function buildManifestTree(structure = {}) {
  const views = [];
  const actions = [];
  const actionIndex = new Map();

  for (const view of structure.views || []) {
    const viewType = view.viewType || VIEW_TYPES.GENERIC;
    const actionRefs = [];
    for (const act of view.actions || []) {
      if (!actionIndex.has(act.id)) {
        const rec = actionRecord(act, view.id);
        actionIndex.set(act.id, rec);
        actions.push(rec);
      } else {
        const rec = actionIndex.get(act.id);
        rec.ownerId = view.id;
      }
      actionRefs.push(act.id);
    }

    views.push({
      id: view.id,
      kind: viewType === VIEW_TYPES.MODAL ? 'modal' : 'view',
      name: view.name || view.id,
      region: view.region || regionForViewType(viewType),
      viewType,
      templateType: view.templateType || templateTypeForView(viewType),
      actionRefs,
      fields: view.fields || [],
      elements: view.elements || [],
      columns: view.columns || [],
      htmlHint: view.htmlHint || '',
    });
  }

  for (const act of structure.actions || []) {
    if (actionIndex.has(act.id)) continue;
    const ownerId = act.parentView ? slugify(act.parentView) : null;
    const rec = actionRecord(act, ownerId);
    actionIndex.set(act.id, rec);
    actions.push(rec);

    if (ownerId) {
      const view =
        views.find((v) => v.id === ownerId) ||
        views.find((v) => v.id.includes(ownerId) || ownerId.includes(v.id));
      if (view && !view.actionRefs.includes(act.id)) {
        view.actionRefs.push(act.id);
      }
    }
  }

  return { views, actions };
}

/**
 * Attach tree to scaffold manifest and sync actionRefs onto file entries.
 */
export function enrichManifestWithTree(manifest, tree) {
  manifest.views = tree.views;
  manifest.actions = tree.actions;

  const schemaFile = manifest.files.find((f) => f.templateType === 'ts_schema');

  for (const view of tree.views) {
    const file = manifest.files.find((f) => f.taskId === view.id);
    if (file) {
      file.actionRefs = view.actionRefs;
      file.region = view.region;
      file.fields = view.fields;
      file.templateType = view.templateType;
      if (view.fields?.length && schemaFile) {
        file.schemaName = schemaFile.schemaName;
      }
      const childActions = view.actionRefs
        .map((id) => tree.actions.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => ({
          id: a.id,
          name: a.name,
          buttonId: a.dataAction || a.id,
        }));
      file.childActions = childActions;
    }
  }

  for (const action of tree.actions) {
    const file = manifest.files.find((f) => f.taskId === action.id);
    if (file) {
      file.ownerId = action.ownerId;
      file.fnName = action.fnName;
      file.importPath = action.importPath;
      file.buttonSelector = action.buttonSelector;
    }
  }

  return manifest;
}
