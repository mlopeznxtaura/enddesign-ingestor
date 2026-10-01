/**
 * Stage 4 — Deterministic coder: template-driven codegen (no LLM).
 * Python bricklayer (cad_executor.py) for core templates; JS for React views.
 */

import {
  defaultStlPythonExport,
  defaultCadViewportTsx,
} from './stl-templates.js';
import { viewComponentName, VIEW_TYPES, actionFnName } from './view-classify.js';
import {
  executeCadPython,
  isPythonBricklayerAvailable,
  shouldUsePythonBricklayer,
} from './python-executor.js';

function toPascal(s = '') {
  return s
    .replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/_/g, '');
}

function toCamel(s = '') {
  const p = toPascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function paramKeyFromElement(el) {
  if (el.id) {
    const parts = el.id.split('_');
    return parts[parts.length - 1] || 'value';
  }
  return paramKeyFromLabel(el.label || 'value');
}

function paramKeyFromLabel(label = '') {
  return label
    .replace(/\([^)]*\)/g, '')
    .trim()
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
    .replace(/[^a-zA-Z0-9]/g, '') || 'value';
}

function defaultForKey(key) {
  const k = key.toLowerCase();
  if (k.includes('diameter') || k.includes('radius')) return 100;
  if (k.includes('width') || k.includes('thickness') || k.includes('bore')) return 8;
  if (k.includes('count') || k.includes('spoke')) return 6;
  if (k.includes('resolution')) return 1024;
  if (k.includes('units')) return 'metric';
  if (k.includes('material')) return 'Permendur';
  if (k.includes('name')) return 'aerohub-part';
  return 0;
}

export function canGenerateDeterministic(entry) {
  return Boolean(entry?.templateType && entry?.deterministic);
}

/**
 * Generate source from manifest entry — tries Python bricklayer when supported, else JS.
 */
export async function generateDeterministicCode(entry, context = {}) {
  if (!entry?.templateType) return null;

  if (shouldUsePythonBricklayer(entry) && isPythonBricklayerAvailable()) {
    try {
      const code = await executeCadPython(entry, context.pythonOptions);
      if (code?.trim()) {
        return { code, source: 'python' };
      }
    } catch (err) {
      if (context.onPythonFallback) {
        context.onPythonFallback(entry, err);
      }
    }
  }

  const code = generateDeterministicCodeJs(entry, context);
  return code ? { code, source: 'javascript' } : null;
}

/**
 * Synchronous JS-only codegen (tests and internal fallback).
 */
export function generateDeterministicCodeJs(entry, context = {}) {
  if (!entry?.templateType) return null;

  switch (entry.templateType) {
    case 'ts_config':
      return buildTsConfig(entry);
    case 'ts_schema':
      return buildTsSchema(entry);
    case 'ts_action_handler':
      return buildActionHandler(entry);
    case 'react_ui_panel':
      return buildReactPanel(entry, context);
    case 'react_viewport_r3f':
      return defaultCadViewportTsx(entry.desc || '3D Viewport');
    case 'react_code_editor':
      return buildCodeEditorPanel(entry);
    case 'react_view_ingest':
      return buildViewIngest(entry);
    case 'react_view_dag':
      return buildViewDag(entry);
    case 'react_view_derived':
      return buildViewDerived(entry);
    case 'react_view_top_bar':
      return buildViewTopBar(entry, context);
    case 'react_view_nav_list':
      return buildViewNavList(entry, context);
    case 'react_view_kanban':
      return buildViewKanban(entry, context);
    case 'react_view_detail':
      return buildViewDetail(entry, context);
    case 'react_view_modal_form':
      return buildViewModalForm(entry, context);
    case 'react_view_fallback_passthrough':
      return buildViewFallbackPassthrough(entry);
    case 'react_view_generic':
      return buildViewGeneric(entry);
    case 'react_app_shell':
      return buildAppShellGrid(entry, context);
    case 'python_stl_export':
      return defaultStlPythonExport();
    default:
      return null;
  }
}

function buildTsSchema(entry) {
  const schemaName = entry.schemaName || 'FormSchema';
  const fields = entry.fields || [];
  const ifaceLines = fields.map((f) => {
    const t = f.dataType === 'number' ? 'number' : 'string';
    return `  ${f.name || f.id}: ${t};`;
  });
  const defaultLines = fields.map((f) => {
    const val =
      f.dataType === 'number'
        ? Number(f.defaultValue) || 0
        : `'${String(f.defaultValue || '').replace(/'/g, "\\'")}'`;
    return `  ${f.name || f.id}: ${val},`;
  });

  return `/** Deterministic schema — ${schemaName} */
export interface ${schemaName} {
${ifaceLines.join('\n')}
}

export const ${schemaName.replace(/Schema$/, '')}Defaults: ${schemaName} = {
${defaultLines.join('\n')}
};
`;
}

function actionButtonLines(childActions = [], className = 'btn') {
  return childActions
    .map(
      (a) =>
        `      <button type="button" className="${className}" data-action="${a.dataAction || a.buttonId || a.id}">${a.name}</button>`,
    )
    .join('\n');
}

function resolveChildActions(entry, context = {}) {
  if (entry.childActions?.length) return entry.childActions;
  const refs = entry.actionRefs || [];
  if (!refs.length) return [];
  const manifestActions =
    context.manifestActions || context.manifest?.actions || [];
  return refs.map((id) => {
    const a = manifestActions.find((x) => x.id === id);
    if (!a) return { id, name: id, buttonId: id, dataAction: id };
    return {
      id: a.id,
      name: a.name || a.id,
      buttonId: a.dataAction || a.id,
      dataAction: a.dataAction || a.id,
    };
  });
}

function buildTsConfig(entry) {
  const prefix = entry.configPrefix || entry.taskId;
  const typeName = toPascal(prefix);
  const elements = entry.params?.length
    ? entry.params.map((p) => ({
        key: paramKeyFromLabel(p.label || p.id),
        label: p.label || p.id,
        default: p.value || defaultForKey(paramKeyFromLabel(p.label || '')),
      }))
    : (entry.configKeys || []).map((k) => ({
        key: k,
        label: k,
        default: defaultForKey(k),
      }));

  const fields = elements.map((e) => {
    const def = e.default;
    const val = typeof def === 'string' ? `'${String(def).replace(/'/g, "\\'")}'` : def;
    return `  ${e.key}: ${val},`;
  });
  const labels = elements.map((e) => `  ${e.key}: '${e.label.replace(/'/g, "\\'")}',`);

  return `/** Deterministic config — ${prefix} */
export const ${prefix}Defaults = {
${fields.join('\n')}
};

export const ${prefix}Labels = {
${labels.join('\n')}
};

export type ${typeName}Config = typeof ${prefix}Defaults;
`;
}

function buildActionHandler(entry) {
  const id = entry.taskId || 'action';
  const fnName = actionFnName(id);
  const name = entry.desc || entry.taskId;
  return `/**
 * Action handler: ${name}
 */
export async function ${fnName}(input: Record<string, unknown> = {}) {
  return { ok: true, action: '${id}', input };
}
`;
}

function buildReactPanel(entry, context = {}) {
  const id = entry.taskId || 'panel';
  const compName = toPascal(id);
  const configImports = (entry.requires || [])
    .filter((r) => r.endsWith('_config'))
    .map((r) => r.replace('_config', ''));

  const imports = configImports
    .map((p) => `import { ${p}Defaults, ${p}Labels } from '../generated/${p}_config';`)
    .join('\n');

  const stateInit = configImports.length
    ? configImports.map((p) => `  ${p}: { ...${p}Defaults },`).join('\n')
    : '  values: {} as Record<string, number | string>,';

  const fields = entry.params?.length
    ? entry.params
    : configImports.flatMap((p) => {
        const keys = Object.keys(
          typeof context.defaults?.[p] === 'object' ? context.defaults[p] : {},
        );
        return keys.map((k) => ({ part: p, key: k, label: k }));
      });

  const inputs = fields.length
    ? fields
        .map((f) => {
          const key = f.key || paramKeyFromLabel(f.label || '');
          const part = f.part || configImports[0] || 'values';
          return `      <label className="input-row">
        <span>${f.label || key}</span>
        <input type="number" value={state.${part}.${key} as number}
          onChange={(e) => setState((s) => ({
            ...s,
            ${part}: { ...s.${part}, ${key}: Number(e.target.value) },
          }))} />
      </label>`;
        })
        .join('\n')
    : `      <p>${entry.desc || compName}</p>`;

  return `import React, { useState } from 'react';
${imports ? `${imports}\n` : ''}
export function ${compName}() {
  const [state, setState] = useState({
${stateInit}
  });

  return (
    <section className="${id}-panel" data-node="${id}">
      <h2>${entry.desc || compName}</h2>
${inputs}
    </section>
  );
}
`;
}

function buildViewIngest(entry) {
  const handlers = (entry.childActions || []).map((a) => {
    const fn = toCamel(`${a.id}_handler`);
    return {
      id: a.id,
      label: a.name,
      fn,
      importPath: `../generated/${a.id}_handler`,
    };
  });
  const handlerImports = handlers
    .map((h) => `import { ${h.fn} } from '${h.importPath}';`)
    .join('\n');
  const handlerButtons = handlers
    .map(
      (h) =>
        `      <button type="button" className="btn btn-primary" onClick={() => ${h.fn}()}>${h.label}</button>`,
    )
    .join('\n');

  return `import React, { useState } from 'react';
${handlerImports ? `${handlerImports}\n` : ''}
export function IngestPanel() {
  const [designText, setDesignText] = useState('');

  return (
    <section className="panel ingest-panel" data-view="ingest">
      <header className="panel-header">
        <h2>Ingest</h2>
        <span className="badge">design source</span>
      </header>
      <div className="panel-body">
        <div className="drop-zone" role="button" tabIndex={0}>
          <strong>Drop design file</strong>
          <p>HTML mockup, JSON DAG, or image screenshot</p>
        </div>
        <label className="field">
          <span className="label">Or paste end-design / DAG spec</span>
          <textarea rows={9} value={designText} onChange={(e) => setDesignText(e.target.value)} />
        </label>
        <div className="ingest-actions">
${handlerButtons || '          <button type="button" className="btn btn-primary">Ingest</button>'}
        </div>
      </div>
    </section>
  );
}
`;
}

function buildViewDag(entry) {
  return `import React from 'react';

export function FunctionDag() {
  return (
    <section className="panel dag-panel" data-view="function_dag">
      <header className="panel-header">
        <h2>Function DAG</h2>
        <span className="badge" id="nodeCount">0 nodes</span>
      </header>
      <div className="dag-canvas" id="dagCanvas">
        <div className="dag-empty">
          <p>Ingest a design to see the backwards function map</p>
        </div>
        <div className="dag-graph" id="dagGraph" />
      </div>
    </section>
  );
}
`;
}

function buildViewDerived(entry) {
  const exports = (entry.childActions || []).filter((a) => /export/i.test(a.name));
  const exportButtons = exports
    .map((a) => `      <button type="button" className="btn-export">${a.name}</button>`)
    .join('\n');

  return `import React from 'react';

export function DerivedOutput() {
  return (
    <section className="panel derived-panel" data-view="derived_components">
      <header className="panel-header">
        <h2>Derived Components</h2>
        <span className="badge accent">0 generated</span>
      </header>
      <div className="panel-body output-panel" id="outputPanel">
        <p className="output-empty">Select a node in the DAG or ingest a design to generate components</p>
      </div>
      <div className="export-bar">
${exportButtons || '        <button type="button" className="btn-export primary">Export All</button>'}
      </div>
    </section>
  );
}
`;
}

function buildViewTopBar(entry, context = {}) {
  const buttons = actionButtonLines(resolveChildActions(entry, context), 'btn');

  return `import React from 'react';

export function TopBar() {
  return (
    <header className="top-bar app-top-bar" data-view="top_bar">
      <div className="brand-title">${entry.desc || 'App'}</div>
      <nav className="top-bar-actions">
${buttons || '        <button type="button" className="btn">Action</button>'}
      </nav>
    </header>
  );
}
`;
}

function buildViewGeneric(entry) {
  const compName = viewComponentName(entry.viewType, entry.taskId);
  return `import React from 'react';

export function ${compName}() {
  return (
    <section className="panel generic-view" data-view="${entry.taskId}">
      <h2>${entry.desc || compName}</h2>
      <p>Generated view scaffold</p>
    </section>
  );
}
`;
}

function buildAppShellGrid(entry, context = {}) {
  const domain = context.domain || 'app-ui';
  const viewIds = entry.viewIds || [];
  const viewRegions = entry.viewRegions || {};
  const manifestViews = context.manifestViews || [];

  const buckets = { top: [], left: [], center: [], right: [], overlay: [] };

  for (const id of viewIds) {
    const meta = manifestViews.find((v) => v.id === id);
    const region = viewRegions[id] || meta?.region || 'center';
    const vt = entry.viewTypes?.[id] || meta?.viewType;
    const name = viewComponentName(vt, id);
    const bucket = buckets[region] || buckets.center;
    bucket.push({ id, name });
  }

  const allViews = [
    ...buckets.top,
    ...buckets.left,
    ...buckets.center,
    ...buckets.right,
    ...buckets.overlay,
  ];

  const imports = allViews
    .map((v) => `import { ${v.name} } from './views/${v.name}';`)
    .join('\n');

  const render = (items) =>
    items.map((v) => `        <${v.name} />`).join('\n') || '        {/* empty */}';

  return `import React from 'react';
${imports ? `${imports}\n` : ''}
/** App shell — region-driven grid wiring all views */
export function AppShell() {
  return (
    <div className="app-root app-grid" data-domain="${domain}">
${render(buckets.top)}
      <div className="app-body">
        <aside className="app-sidebar">
${render(buckets.left)}
        </aside>
        <main className="app-main">
${render(buckets.center)}
        </main>
        <aside className="app-right">
${render(buckets.right)}
        </aside>
      </div>
${render(buckets.overlay)}
    </div>
  );
}
`;
}

function buildCodeEditorPanel(entry) {
  const snippet = (entry.snippet || '// generated scaffold').replace(/`/g, '\\`');
  return `import React, { useState } from 'react';

export function CodeEditorView() {
  const [code, setCode] = useState(` + '`' + snippet.slice(0, 800) + '`' + `);

  return (
    <section className="code-editor-panel" data-node="code_editor">
      <h2>Code Editor</h2>
      <textarea
        className="code-area"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={16}
      />
    </section>
  );
}
`;
}

function buildViewNavList(entry, context = {}) {
  const elements = entry.elements || [];
  const navItems = elements.length
    ? elements
        .map((el) => {
          const badge = el.badge
            ? '<span className="badge">' + el.badge + '</' + 'span>'
            : '';
          return '        <li className="nav-item">' + el.label + badge + '</li>';
        })
        .join('\n')
    : `        <li className="nav-item">Leads</li>`;

  const buttons = actionButtonLines(resolveChildActions(entry, context), 'btn btn-sidebar');

  return `import React from 'react';

export function Sidebar() {
  return (
    <aside className="sidebar panel" data-view="sidebar">
      <h2>${entry.desc || 'Sidebar'}</h2>
      <ul className="nav-list">
${navItems}
      </ul>
      <div className="sidebar-actions">
${buttons}
      </div>
    </aside>
  );
}
`;
}

function buildViewKanban(entry, context = {}) {
  const cols = entry.columns || ['New', 'Qualified', 'Proposal'];
  const columns = cols
    .map(
      (c) =>
        `        <div className="kanban-col"><h3>${c}</h3><div className="kanban-cards" /></div>`,
    )
    .join('\n');
  const buttons = actionButtonLines(resolveChildActions(entry, context), 'btn');

  return `import React from 'react';

export function MainPipeline() {
  return (
    <main className="main-view kanban-board" data-view="kanban">
      <header className="panel-header">
        <h2>${entry.desc || 'Pipeline Board'}</h2>
        <div className="kanban-actions">
${buttons}
        </div>
      </header>
      <div className="kanban-columns">
${columns}
      </div>
    </main>
  );
}
`;
}

function buildViewDetail(entry, context = {}) {
  const buttons = actionButtonLines(resolveChildActions(entry, context), 'btn');
  return `import React from 'react';

export function RightPanel() {
  return (
    <aside className="right-panel panel" data-view="right_panel">
      <h2>${entry.desc || 'Detail Panel'}</h2>
      <div className="lead-detail">
        <p>Select a lead to view details</p>
      </div>
      <div className="right-actions">
${buttons}
      </div>
    </aside>
  );
}
`;
}

function buildViewModalForm(entry, context = {}) {
  const compName = viewComponentName(entry.viewType, entry.taskId);
  const schemaName = entry.schemaName || 'LeadSchema';
  const fields = entry.fields || [];
  const fieldInputs = fields.length
    ? fields
        .map(
          (f) =>
            `        <label className="field">
          <span>${f.label || f.name}</span>
          <input type="${f.dataType === 'number' ? 'number' : 'text'}" data-field="${f.name}" />
        </label>`,
        )
        .join('\n')
    : `        <label className="field"><span>Name</span><input data-field="lead_name" /></label>`;

  const buttons = actionButtonLines(resolveChildActions(entry, context), 'btn');

  return `import React from 'react';
import { ${schemaName.replace(/Schema$/, '')}Defaults } from '../generated/${schemaName}';

export function ${compName}() {
  return (
    <div className="modal overlay" id="${entry.taskId}" data-view="${entry.taskId}" role="dialog">
      <div className="modal-content">
        <h2>${entry.desc || compName}</h2>
        <form className="modal-form">
${fieldInputs}
        </form>
        <div className="modal-actions">
${buttons}
        </div>
      </div>
    </div>
  );
}
`;
}

function buildViewFallbackPassthrough(entry) {
  const compName = viewComponentName(entry.viewType, entry.taskId);
  const hint = (entry.htmlHint || '').replace(/`/g, '\\`').slice(0, 200);
  return `import React from 'react';

/** UNSUPPORTED_KIND — static passthrough, not wired */
export function ${compName}() {
  return (
    <section className="fallback-passthrough" data-fallback="UNSUPPORTED_KIND" data-view="${entry.taskId}">
      <h2>${entry.desc || compName}</h2>
      <p>Region rendered as static passthrough — template ${entry.templateType}</p>
      <pre>${hint}</pre>
    </section>
  );
}
`;
}

/**
 * Map manifest entry → DAG node for path/sanitize helpers.
 */
export function manifestEntryToNode(entry) {
  return {
    id: entry.taskId,
    name: entry.desc || entry.taskId,
    type: entry.type || 'fn',
    kind: entry.kind,
    params: entry.params,
    templateType: entry.templateType,
    viewType: entry.viewType,
    childActions: entry.childActions,
    actionRefs: entry.actionRefs,
    fields: entry.fields,
    viewIds: entry.viewIds,
    viewRegions: entry.viewRegions,
    schemaName: entry.schemaName,
    viewPath: entry.path,
  };
}
