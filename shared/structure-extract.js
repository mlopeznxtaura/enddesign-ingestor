/**
 * Extract structured UI design from HTML (regex — browser + Node).
 */

import {
  inferViewType,
  isChromeButton,
  assignButtonParentView,
  VIEW_TYPES,
  regionForViewType,
  templateTypeForView,
  REGIONS,
} from './view-classify.js';
import {
  canonicalActionId,
  decodeHtmlEntities,
  extractDataActionFromContext,
  slugifyActionId,
} from './action-id.js';

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}

function stripTags(s = '') {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function detectDomain(text, structure = {}) {
  const blob = `${text} ${JSON.stringify(structure)}`.toLowerCase();
  if (/stl|build123d|permendur|stator|parametric|\.stl|aerohub/i.test(blob)) return 'cad-stl';
  if (/gtm|launchpad|campaign|funnel|mql|sql|icp|nurture|linkedin ads|book demo/i.test(blob)) {
    return 'gtm-marketing';
  }
  if (/crm|pipeline|kanban|lead_card|add_lead|sales/i.test(blob)) return 'crm-pipeline';
  if (/oauth|token|provider|pkce|revoke/i.test(blob)) return 'oauth-workflow';
  if (/dashboard|saas|table|chart|analytics/i.test(blob)) return 'dashboard';
  if (/api contract|endpoint|graphql|rest api/i.test(blob)) return 'api';
  return 'app-ui';
}

export function extractHTMLStructure(html) {
  const columns = [];
  const parts = [];
  const params = [];
  const materials = [];
  let codeSnippet = '';
  let appTitle = '';

  const titleMatch = html.match(/<title[^>]*>([^<]+)</i);
  if (titleMatch) appTitle = stripTags(titleMatch[1]);

  const brandMatch = html.match(/class=["'][^"']*brand-title[^"']*["'][^>]*>([^<]+)/i);
  if (brandMatch) appTitle = appTitle || stripTags(brandMatch[1]);

  // data-key items (existing convention)
  const dataKeyRegex = /data-key=["']([^"']+)["']/gi;
  let m;
  while ((m = dataKeyRegex.exec(html)) !== null) {
    const id = slugify(m[1]);
    columns.push({ id, name: m[1], type: 'region', source: 'data-key' });
  }

  // panel titles → columns / regions
  const panelTitleRegex = /class=["'][^"']*panel-title[^"']*["'][^>]*>([^<]+)/gi;
  while ((m = panelTitleRegex.exec(html)) !== null) {
    const name = stripTags(m[1]);
    if (!name) continue;
    const id = slugify(name);
    if (!columns.find((c) => c.id === id)) {
      columns.push({ id, name, type: 'panel', source: 'panel-title' });
    }
  }

  // parameter groups → parts
  const groupRegex =
    /class=["'][^"']*parameter-group[^"']*["'][^>]*>([\s\S]*?)(?=<div class=["'][^"']*parameter-group|<div class=["']section-divider|<\/main|<\/section)/gi;
  while ((m = groupRegex.exec(html)) !== null) {
    const block = m[1];
    const labelMatch = block.match(/class=["'][^"']*group-label[^"']*["'][^>]*>([^<]+)/i);
    const partName = labelMatch ? stripTags(labelMatch[1]) : 'Part';
    const partId = slugify(partName);
    const partParams = [];

    const rowRegex =
      /class=["'][^"']*input-row[^"']*["'][^>]*>[\s\S]*?<label[^>]*>([^<]*)<\/label>[\s\S]*?(?:value=["']([^"']*)["']|>([^<]*)<\/option)/gi;
    let row;
    while ((row = rowRegex.exec(block)) !== null) {
      const label = stripTags(row[1]);
      const value = row[2] || row[3] || '';
      if (!label) continue;
      const param = { id: slugify(`${partId}_${label}`), label, value: stripTags(value), partId };
      partParams.push(param);
      params.push(param);
    }

    parts.push({ id: partId, name: partName, params: partParams });
  }

  // standalone input rows outside groups
  const looseRowRegex =
    /class=["'][^"']*input-row[^"']*["'][^>]*>[\s\S]*?<label[^>]*>([^<]*)<\/label>[\s\S]*?value=["']([^"']*)["']/gi;
  while ((m = looseRowRegex.exec(html)) !== null) {
    const label = stripTags(m[1]);
    const value = stripTags(m[2]);
    if (!label || params.find((p) => p.label === label)) continue;
    params.push({ id: slugify(label), label, value, partId: 'general' });
  }

  // selects (materials)
  const selectRegex = /<select[^>]*>([\s\S]*?)<\/select>/gi;
  while ((m = selectRegex.exec(html)) !== null) {
    const opt = m[1].match(/<option[^>]*>([^<]+)/i);
    if (opt) materials.push(stripTags(opt[1]));
  }

  // UI views (containers) — nouns before verb actions
  const views = extractViewsFromHtml(html);

  // Primary action buttons (verbs) — exclude chrome; attach parentView when known
  const actions = extractActionsFromHtml(html, views);

  // Legacy: also pick toolbar buttons from class=btn if not captured
  const btnRegex = /class=["']([^"']*btn[^"']*)["'][^>]*>([^<]+)/gi;
  while ((m = btnRegex.exec(html)) !== null) {
    const classes = m[1];
    const label = stripTags(m[2]);
    if (label.length < 2 || isChromeButton(classes)) continue;
    const ctx = html.slice(Math.max(0, m.index - 120), m.index + 120);
    const idMatch = ctx.match(/id=["']([^"']+)["']/i);
    const btnId = idMatch?.[1] || slugify(label);
    const dataAction = extractDataActionFromContext(ctx, html, m.index);
    const actId = canonicalActionId(dataAction, btnId, label);
    const already =
      views.some((v) => v.actions.some((a) => a.id === actId)) ||
      actions.some((a) => a.id === actId);
    if (already) continue;
    const parentView =
      findParentViewFromHtml(html, m.index, views) ||
      assignButtonParentView(btnId, label, dataAction) ||
      null;
    const action = {
      id: actId,
      name: label,
      type: 'button',
      buttonId: btnId,
      dataAction: dataAction ? slugifyActionId(dataAction) : actId,
    };
    if (parentView) {
      if (!attachActionToView(views, parentView, action)) {
        actions.push({ ...action, parentView });
      }
    } else {
      actions.push(action);
    }
  }

  // code editor content
  const codeMatch = html.match(/class=["'][^"']*code-area[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (codeMatch) {
    codeSnippet = stripTags(codeMatch[1]).slice(0, 4000);
  }

  const domain = detectDomain(html, { columns, parts, actions });

  return {
    appTitle,
    domain,
    columns,
    parts,
    params,
    views,
    actions,
    materials,
    codeSnippet,
    confidence: views.length + parts.length + params.length > 0 ? 0.85 : 0.4,
  };
}

function extractFormFieldsFromBlock(block) {
  const fields = [];
  const fieldRegex =
    /<(?:input|select|textarea)([^>]*data-field=["']([^"']+)["'][^>]*)>/gi;
  let fm;
  while ((fm = fieldRegex.exec(block)) !== null) {
    const attrs = fm[1];
    const name = fm[2];
    const labelMatch = block.slice(Math.max(0, fm.index - 120), fm.index).match(
      /<label[^>]*>([^<]+)</i,
    );
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    const valueMatch = attrs.match(/value=["']([^"']*)["']/i);
    fields.push({
      name,
      id: slugify(name),
      label: labelMatch ? stripTags(labelMatch[1]) : name,
      dataType: typeMatch?.[1] === 'number' ? 'number' : 'string',
      defaultValue: valueMatch?.[1] || '',
    });
  }
  return fields;
}

function findParentViewFromHtml(html, btnIndex, views) {
  const before = html.slice(0, btnIndex);
  const signals = [
    { re: /class=["'][^"']*top-bar|<header[\s>]/gi, keys: ['top_bar'] },
    { re: /<div[^>]*id=["'][^"']*modal[^"']*["']/gi, keys: ['add_lead_modal', 'modal'] },
    { re: /<aside[^>]*class=["'][^"']*right-panel/gi, keys: ['right_panel', 'right'] },
    { re: /<aside[^>]*class=["'][^"']*sidebar/gi, keys: ['sidebar'] },
    { re: /<main[\s>]/gi, keys: ['kanban', 'main_view'] },
  ];

  let bestKey = null;
  let bestPos = -1;
  for (const sig of signals) {
    let m;
    const re = new RegExp(sig.re.source, 'gi');
    while ((m = re.exec(before)) !== null) {
      if (m.index > bestPos) {
        bestPos = m.index;
        bestKey = sig.keys[0];
      }
    }
  }

  if (!bestKey) return null;
  const view =
    views.find((v) => v.id === bestKey) ||
    views.find((v) => sigMatchView(v, bestKey));
  return view?.id || bestKey;
}

function sigMatchView(view, key) {
  return view.id.includes(key) || key.includes(view.id);
}

function extractLayoutRegionsFromHtml(html, addView) {
  const asideRegex = /<aside([^>]*)>([\s\S]*?)<\/aside>/gi;
  let am;
  while ((am = asideRegex.exec(html)) !== null) {
    const attrs = am[1];
    const block = am[0];
    const classes = attrs.match(/class=["']([^"']*)["']/i)?.[1] || '';
    const idAttr = attrs.match(/id=["']([^"']+)["']/i)?.[1];
    if (/sidebar|left-nav/i.test(classes) || /sidebar/i.test(idAttr || '')) {
      const elements = extractNavElements(block);
      addView('sidebar', 'Sidebar', VIEW_TYPES.SIDEBAR, {
        region: REGIONS.LEFT,
        templateType: 'react_view_nav_list',
        elements,
        htmlHint: block.slice(0, 400),
      });
    } else if (/right-panel|right_panel/i.test(classes) || /right/i.test(idAttr || '')) {
      addView('right_panel', 'Right Panel', VIEW_TYPES.RIGHT_PANEL, {
        region: REGIONS.RIGHT,
        templateType: 'react_view_detail',
        htmlHint: block.slice(0, 400),
      });
    }
  }

  const mainRegex = /<main([^>]*)>([\s\S]*?)<\/main>/gi;
  let mm;
  while ((mm = mainRegex.exec(html)) !== null) {
    const block = mm[0];
    const columns = extractKanbanColumns(block);
    addView('kanban', 'Pipeline Board', VIEW_TYPES.KANBAN, {
      region: REGIONS.CENTER,
      templateType: 'react_view_kanban',
      columns,
      htmlHint: block.slice(0, 400),
    });
  }

  const modalRegex =
    /<div([^>]*(?:id=["'][^"']*modal[^"']*["']|class=["'][^"']*modal[^"']*["']|role=["']dialog["'])[^>]*)>([\s\S]*?)<\/div>/gi;
  let mod;
  while ((mod = modalRegex.exec(html)) !== null) {
    const attrs = mod[1];
    const block = mod[0];
    const idAttr = attrs.match(/id=["']([^"']+)["']/i)?.[1] || 'modal';
    const id = slugify(idAttr);
    const fields = extractFormFieldsFromBlock(block);
    addView(id, 'Modal Form', VIEW_TYPES.MODAL, {
      region: REGIONS.OVERLAY,
      templateType: 'react_view_modal_form',
      fields,
      htmlHint: block.slice(0, 400),
    });
  }
}

function extractNavElements(block) {
  const items = [];
  const navRegex = /<(?:a|button|li)([^>]*)>([\s\S]*?)<\/(?:a|button|li)>/gi;
  let m;
  while ((m = navRegex.exec(block)) !== null) {
    const label = stripTags(m[2]);
    if (label.length < 2) continue;
    const badge = m[0].match(/class=["'][^"']*badge[^"']*["'][^>]*>([^<]+)/i);
    items.push({
      type: 'nav_item',
      label: label.slice(0, 40),
      badge: badge ? stripTags(badge[1]) : '',
    });
  }
  return items.slice(0, 12);
}

function extractKanbanColumns(block) {
  const cols = [];
  const colRegex = /class=["'][^"']*kanban-col[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = colRegex.exec(block)) !== null) {
    const title = m[1].match(/<h\d[^>]*>([^<]+)/i);
    if (title) cols.push(stripTags(title[1]));
  }
  if (!cols.length && /new|qualified|proposal/i.test(block)) {
    return ['New', 'Qualified', 'Proposal'];
  }
  return cols;
}

function extractViewsFromHtml(html) {
  const views = [];
  const seen = new Set();

  const addView = (id, name, viewType, extra = {}) => {
    const normId = slugify(id);
    if (!normId || seen.has(normId)) return;
    seen.add(normId);
    views.push({
      id: normId,
      name: name || normId,
      viewType,
      classification: 'UI_VIEW',
      actions: [],
      ...extra,
    });
  };

  if (/class=["'][^"']*top-bar/i.test(html) || /<header[\s>]/i.test(html)) {
    addView('top_bar', 'Top Bar', VIEW_TYPES.TOP_BAR, {
      region: REGIONS.TOP,
      templateType: 'react_view_top_bar',
    });
  }

  extractLayoutRegionsFromHtml(html, addView);

  if (/id=["']dropZone["']/i.test(html) || /class=["'][^"']*drop-zone/i.test(html)) {
    addView('ingest', 'Ingest', VIEW_TYPES.INGEST);
  }

  if (/id=["']dagCanvas["']/i.test(html) || /class=["'][^"']*dag-canvas/i.test(html)) {
    addView('function_dag', 'Function DAG', VIEW_TYPES.DAG);
  }

  if (/id=["']outputPanel["']/i.test(html) || /derived\s*components/i.test(html)) {
    addView('derived_components', 'Derived Components', VIEW_TYPES.DERIVED);
  }

  const sectionRegex =
    /<(?:section|div)[^>]*class=["'][^"']*panel[^"']*["'][^>]*>([\s\S]*?)<\/(?:section|div)>/gi;
  let sm;
  while ((sm = sectionRegex.exec(html)) !== null) {
    const block = sm[0];
    const dataKey = block.match(/data-key=["']([^"']+)["']/i);
    const titleMatch = block.match(/class=["'][^"']*panel-title[^"']*["'][^>]*>([^<]+)/i);
    const name = titleMatch ? stripTags(titleMatch[1]) : dataKey?.[1] || 'Panel';
    const id = dataKey ? slugify(dataKey[1]) : slugify(name);
    const viewType = inferViewType(name, id, block);
    addView(id, name, viewType, {
      htmlHint: block.slice(0, 400),
      region: regionForViewType(viewType),
      templateType: templateTypeForView(viewType),
      fields: extractFormFieldsFromBlock(block),
    });
  }

  const dataKeyRegex = /data-key=["']([^"']+)["']/gi;
  let dm;
  while ((dm = dataKeyRegex.exec(html)) !== null) {
    const id = slugify(dm[1]);
    const viewType = inferViewType(dm[1], id, html.slice(dm.index, dm.index + 300));
    addView(id, dm[1], viewType);
  }

  if (/class=["'][^"']*chart-panel/i.test(html)) {
    addView('chart_panel', 'Chart Panel', VIEW_TYPES.MAIN_PANEL, {
      region: REGIONS.CENTER,
      templateType: 'react_view_generic',
    });
  }

  if (/class=["'][^"']*kanban-card/i.test(html)) {
    addView('kanban_card', 'Kanban Card', VIEW_TYPES.KANBAN, {
      region: REGIONS.CENTER,
      templateType: 'react_view_generic',
    });
  }

  return views;
}

function extractActionsFromHtml(html, views) {
  const actions = [];
  const seen = new Set();
  const btnTagRegex = /<(?:button|input)([^>]*)>(?:([\s\S]*?)<\/(?:button|input)>|)/gi;
  let m;
  while ((m = btnTagRegex.exec(html)) !== null) {
    const attrs = m[1];
    const inner = m[2] || '';
    const label = stripTags(inner) || attrs.match(/value=["']([^"']+)["']/i)?.[1] || '';
    if (label.length < 2) continue;
    const classMatch = attrs.match(/class=["']([^"']*)["']/i);
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
    if (typeMatch && !/^(button|submit)$/i.test(typeMatch[1])) continue;
    const classes = classMatch?.[1] || '';
    const btnId = idMatch?.[1] || slugify(label);
    const dataAction = extractDataActionFromContext(attrs, html, m.index);
    if (isChromeButton(classes, btnId)) continue;

    const actId = canonicalActionId(dataAction, btnId, label);
    if (seen.has(actId)) continue;
    seen.add(actId);

    const parentFromContext = findParentViewFromHtml(html, m.index, views);
    const parentView =
      parentFromContext ||
      assignButtonParentView(btnId, label, dataAction) ||
      null;

    const action = {
      id: actId,
      name: label,
      type: 'button',
      buttonId: btnId,
      dataAction: dataAction ? slugifyActionId(dataAction) : actId,
      classification: 'ACTION_BUTTON',
      parentView: parentView || null,
    };

    if (parentView) {
      if (!attachActionToView(views, parentView, action)) {
        actions.push({ ...action, parentView });
      }
    } else {
      actions.push(action);
    }
  }
  return actions;
}

function attachActionToView(views, parentKey, action) {
  const key = slugify(parentKey);
  const view =
    views.find((v) => v.id === key) ||
    views.find((v) => v.id.includes(key) || key.includes(v.id));
  if (view) {
    if (!view.actions.find((a) => a.id === action.id)) view.actions.push(action);
    return true;
  }
  return false;
}

export function parseVisionElements(json) {
  const elements = json.elements || json.items || [];
  const columns = [];
  const parts = [];
  const params = [];
  const actions = [];

  for (const el of elements) {
    const name = el.label || el.name || el.identifier || 'Element';
    const id = slugify(el.identifier || el.id || name);
    const type = (el.type || 'ui').toLowerCase();

    if (type.includes('button') || type.includes('action')) {
      actions.push({ id, name, type: 'button', desc: el.description || '' });
    } else if (type.includes('input') || type.includes('field') || type.includes('param')) {
      params.push({ id, label: name, value: el.value || '', partId: 'vision' });
    } else if (type.includes('panel') || type.includes('column') || type.includes('section')) {
      columns.push({ id, name, type: 'panel', source: 'vision' });
    } else {
      columns.push({ id, name, type: 'region', source: 'vision', desc: el.description || '' });
    }
  }

  return {
    appTitle: json.appTitle || json.title || 'App Vision',
    domain: detectDomain(JSON.stringify(json), { columns, parts, actions }),
    columns,
    parts,
    params,
    actions,
    materials: json.materials || [],
    codeSnippet: json.codeSnippet || '',
    confidence: elements.length ? 0.75 : 0.3,
    source: 'vision',
  };
}
