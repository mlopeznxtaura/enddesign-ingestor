/**
 * Stage 4.5 — deterministic handler binding pass (imports + onClick).
 */

import { actionFnName } from './view-classify.js';

/**
 * @param {string} content - view TSX source
 * @param {object} viewMeta - from manifest.views
 * @param {object[]} actions - manifest.actions
 */
export function bindActionsToView(content, viewMeta, actions = []) {
  if (!viewMeta?.actionRefs?.length) return content;

  const viewActions = viewMeta.actionRefs
    .map((id) => actions.find((a) => a.id === id))
    .filter(Boolean);

  if (!viewActions.length) return content;

  let out = content;
  const importLines = [];

  const missing = viewActions.filter((action) => {
    const da = action.dataAction || action.id;
    return !new RegExp(`data-action=["']${escapeRegExp(da)}["']`, 'i').test(out);
  });

  if (missing.length) {
    const navMatch = out.match(
      /<nav[^>]*className=["'][^"']*(?:top-bar-actions|panel-actions|view-actions)[^"']*["'][^>]*>/i,
    );
    if (navMatch) {
      const insertLines = missing
        .map((action) => {
          const da = action.dataAction || action.id;
          const fn = action.fnName || actionFnName(action.id);
          return `        <button type="button" className="btn" data-action="${da}" onClick={() => ${fn}()}>${action.name || action.id}</button>`;
        })
        .join('\n');
      out = out.replace(navMatch[0], `${navMatch[0]}\n${insertLines}`);
    }
  }

  for (const action of viewActions) {
    const fn = action.fnName || actionFnName(action.id);
    const importPath = action.importPath || `../generated/${action.id}_handler`;
    const importLine = `import { ${fn} } from '${importPath}';`;

    if (!out.includes(importLine)) {
      importLines.push(importLine);
    }

    const dataAction = action.dataAction || action.id;
    const onClickSnippet = `onClick={() => ${fn}()}`;

    const btnPatterns = [
      new RegExp(
        `(<button[^>]*data-action=["']${escapeRegExp(dataAction)}["'][^>]*)>`,
        'i',
      ),
      new RegExp(`(<button[^>]*id=["'][^"']*${escapeRegExp(action.id)}[^"']*["'][^>]*)>`, 'i'),
    ];

    for (const pat of btnPatterns) {
      out = out.replace(pat, (match, prefix) => {
        if (prefix.includes('onClick')) return match;
        return `${prefix} ${onClickSnippet}>`;
      });
    }
  }

  if (importLines.length) {
    if (out.includes('import React')) {
      out = out.replace(/^(import React[^\n]*\n)/, `$1${importLines.join('\n')}\n`);
    } else {
      out = `${importLines.join('\n')}\n${out}`;
    }
  }

  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run binding for all views in manifest against generated files.
 */
export function bindAllViewActions(files, manifest) {
  const views = manifest?.views || [];
  const actions = manifest?.actions || [];
  const bound = [];

  for (const viewMeta of views) {
    const file = files.find((f) => f.taskId === viewMeta.id && f.path?.endsWith('.tsx'));
    if (!file) continue;
    const before = file.content;
    file.content = bindActionsToView(before, viewMeta, actions);
    if (file.content !== before) {
      bound.push(viewMeta.id);
    }
  }

  return bound;
}
