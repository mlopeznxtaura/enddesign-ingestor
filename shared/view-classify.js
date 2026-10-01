/**
 * UI_VIEW vs ACTION_BUTTON classification helpers.
 */

export const VIEW_TYPES = {
  INGEST: 'ingest_panel',
  DAG: 'dag_canvas',
  DERIVED: 'derived_output',
  VIEWPORT: 'viewport_3d',
  CODE_EDITOR: 'code_editor',
  TOP_BAR: 'top_bar',
  PARAM_PANEL: 'param_panel',
  SIDEBAR: 'sidebar',
  NAV_LIST: 'nav_list',
  KANBAN: 'kanban',
  MAIN_PANEL: 'main_panel',
  RIGHT_PANEL: 'right_panel',
  MODAL: 'modal',
  GENERIC: 'generic_panel',
};

export const REGIONS = {
  TOP: 'top',
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  OVERLAY: 'overlay',
};

const CHROME_BTN =
  /drop-type-chip|btn-export|sample-item|btn-sandbox|btn-copy|sandbox-live/i;

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

export function templateTypeForView(viewType) {
  return VIEW_TEMPLATE_MAP[viewType] || 'react_view_generic';
}

export function regionForViewType(viewType) {
  switch (viewType) {
    case VIEW_TYPES.TOP_BAR:
      return REGIONS.TOP;
    case VIEW_TYPES.SIDEBAR:
    case VIEW_TYPES.NAV_LIST:
    case VIEW_TYPES.PARAM_PANEL:
      return REGIONS.LEFT;
    case VIEW_TYPES.KANBAN:
    case VIEW_TYPES.MAIN_PANEL:
    case VIEW_TYPES.VIEWPORT:
    case VIEW_TYPES.DAG:
    case VIEW_TYPES.DERIVED:
      return REGIONS.CENTER;
    case VIEW_TYPES.RIGHT_PANEL:
    case VIEW_TYPES.CODE_EDITOR:
      return REGIONS.RIGHT;
    case VIEW_TYPES.MODAL:
      return REGIONS.OVERLAY;
    case VIEW_TYPES.INGEST:
      return REGIONS.OVERLAY;
    default:
      return REGIONS.CENTER;
  }
}

export function inferViewType(name = '', id = '', chunk = '') {
  const blob = `${name} ${id} ${chunk}`.toLowerCase();
  if (/modal|dialog|overlay/.test(blob) && /modal|#add.*lead/i.test(blob)) {
    return VIEW_TYPES.MODAL;
  }
  if (/drop[-_]?zone|ingest(?!\s*&)/.test(blob) && !/function\s*dag/.test(blob)) {
    return VIEW_TYPES.INGEST;
  }
  if (/function\s*dag|dag[-_]?canvas|dag_graph|dag-canvas/.test(blob)) {
    return VIEW_TYPES.DAG;
  }
  if (/kanban|pipeline\s*board|main[-_]?view/.test(blob)) {
    return VIEW_TYPES.KANBAN;
  }
  if (/sidebar|left[-_]?nav|nav[-_]?list/.test(blob)) {
    return VIEW_TYPES.SIDEBAR;
  }
  if (/right[-_]?panel|detail\s*panel|lead\s*detail/.test(blob)) {
    return VIEW_TYPES.RIGHT_PANEL;
  }
  if (/derived|output\s*panel|components|compcount|analytics|funnel|dashboard/.test(blob)) {
    return VIEW_TYPES.DERIVED;
  }
  if (/viewport|3d\s*preview|center[-_]?panel/.test(blob)) {
    return VIEW_TYPES.VIEWPORT;
  }
  if (/code\s*editor|code[-_]?area|monaco|right[-_]?editor/.test(blob)) {
    return VIEW_TYPES.CODE_EDITOR;
  }
  if (/top[-_]?bar|^header$|brand-title/.test(blob)) {
    return VIEW_TYPES.TOP_BAR;
  }
  if (/parameter|parametric|left[-_]?panel/.test(blob)) {
    return VIEW_TYPES.PARAM_PANEL;
  }
  return VIEW_TYPES.GENERIC;
}

export function isChromeButton(classes = '', id = '') {
  return CHROME_BTN.test(classes) || CHROME_BTN.test(id);
}

export function assignButtonParentView(btnId = '', label = '', dataAction = '') {
  const raw = (dataAction || btnId).toLowerCase().replace(/-/g, '_');
  const id = raw.replace(/[^a-z0-9_]/g, '_');
  const l = label.toLowerCase().trim();
  // Ingest chrome only — exact tokens, not clear_queue / clear_alerts substring matches
  if (
    /^(ingest|designinput|dropzone|brief|clear_brief|clear_design)$/.test(id) ||
    /^ingest$|^clear brief$/i.test(l)
  ) {
    return 'ingest';
  }
  if (/save_lead|cancel/.test(id)) {
    return 'add_lead_modal';
  }
  if (/add_lead/.test(id)) {
    return 'top_bar';
  }
  if (/export_csv|export_leads/.test(id) || /export csv/.test(l)) {
    return 'sidebar';
  }
  if (
    /exportprompt|exportdag|exportall|export_zip|download|export report/.test(id) ||
    /export report/.test(l)
  ) {
    return 'derived_components';
  }
  if (/move|toggle_view|kanban/.test(id)) {
    return 'kanban';
  }
  if (/sync|refresh/.test(id)) {
    return 'top_bar';
  }
  if (/startbuild|stopbuild|build-console/.test(id)) return 'build_console';
  if (
    /^new$|^open$|build.*stl|export.*stl|launch campaign|publish|schedule/.test(l) ||
    /topbar|top_bar|btn-launch/.test(btnId.toLowerCase())
  ) {
    return 'top_bar';
  }
  return null;
}

export function actionFnName(actionId = '') {
  const parts = actionId.replace(/-/g, '_').split('_');
  const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  return pascal.charAt(0).toLowerCase() + pascal.slice(1) + '_handler';
}

export function actionImportPath(actionId = '') {
  return `../generated/${actionId}_handler`;
}

export function viewComponentName(viewType, id = '') {
  const map = {
    [VIEW_TYPES.INGEST]: 'IngestPanel',
    [VIEW_TYPES.DAG]: 'FunctionDag',
    [VIEW_TYPES.DERIVED]: 'DerivedOutput',
    [VIEW_TYPES.VIEWPORT]: 'CenterViewport',
    [VIEW_TYPES.CODE_EDITOR]: 'CodeEditorView',
    [VIEW_TYPES.TOP_BAR]: 'TopBar',
    [VIEW_TYPES.SIDEBAR]: 'Sidebar',
    [VIEW_TYPES.NAV_LIST]: 'Sidebar',
    [VIEW_TYPES.KANBAN]: 'MainPipeline',
    [VIEW_TYPES.MAIN_PANEL]: 'MainPipeline',
    [VIEW_TYPES.RIGHT_PANEL]: 'RightPanel',
    [VIEW_TYPES.MODAL]: null,
    [VIEW_TYPES.PARAM_PANEL]: null,
    [VIEW_TYPES.GENERIC]: null,
  };
  if (viewType === VIEW_TYPES.MODAL) {
    return id
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');
  }
  if (map[viewType]) return map[viewType];
  return id
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export function viewPathFor(viewType, id = '') {
  const name = viewComponentName(viewType, id);
  return `src/views/${name}.tsx`;
}
