/**
 * Deterministic template registry + fail-closed preflight.
 */

export class BuildAbort extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BuildAbort';
    this.details = details;
  }
}

export const TEMPLATE_REGISTRY = new Set([
  'ts_config',
  'ts_schema',
  'ts_action_handler',
  'python_stl_export',
  'react_ui_panel',
  'react_viewport_r3f',
  'react_code_editor',
  'react_view_ingest',
  'react_view_dag',
  'react_view_derived',
  'react_view_top_bar',
  'react_view_generic',
  'react_view_nav_list',
  'react_view_kanban',
  'react_view_detail',
  'react_view_modal_form',
  'react_view_fallback_passthrough',
  'react_app_shell',
]);

/**
 * @param {object} manifest
 * @param {{ strictMode?: boolean }} options
 */
export function preflightTemplateCoverage(manifest, options = {}) {
  const strictMode = options.strictMode ?? true;
  const flags = [];
  const views = manifest.views || [];

  for (const view of views) {
    if (!view.templateType) continue;
    if (TEMPLATE_REGISTRY.has(view.templateType)) continue;

    if (strictMode) {
      throw new BuildAbort(`MISSING_TEMPLATE: ${view.id} (${view.templateType})`, {
        viewId: view.id,
        templateType: view.templateType,
      });
    }

    view.templateType = 'react_view_fallback_passthrough';
    flags.push({
      viewId: view.id,
      code: 'UNSUPPORTED_KIND',
      message: 'static passthrough, not wired',
    });
  }

  return flags;
}
