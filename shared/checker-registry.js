/**
 * Data-driven validation rule checkers for manifest validationRules.
 */

function test(id, pass, message, severity = 'critical') {
  return { id, pass, message, severity };
}

export const CHECKER_REGISTRY = {
  non_empty: (content, meta) =>
    test(
      'non_empty',
      content.trim().length > 15,
      content.trim().length > 15 ? 'content present' : 'file is empty or too short',
      'critical',
    ),

  no_markdown: (content) =>
    test('no_markdown', !content.includes('```'), 'no markdown fences in output', 'high'),

  view_layout: (content, meta) =>
    test(
      'view_layout',
      /data-view=|className=/.test(content),
      'React section with layout region marker',
      'high',
    ),

  view_imports_handlers: (content, meta, rule) => {
    const refs = meta.actionRefs || meta.childActions?.map((a) => a.id) || [];
    if (!refs.length) {
      return test('view_imports_handlers', true, 'no actions to wire', 'high');
    }
    const missing = [];
    for (const id of refs) {
      const fn =
        meta.actions?.find((a) => a.id === id)?.fnName ||
        id
          .split('_')
          .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
          .join('')
          .replace(/^(.)/, (c) => c.toLowerCase()) + '_handler';
      if (!content.includes(`import { ${fn}`) && !content.includes(`import {${fn}`)) {
        missing.push(`import ${fn}`);
      }
      if (!content.includes(`${fn}()`) && !content.includes(`${fn}(`)) {
        missing.push(`call ${fn}`);
      }
    }
    return test(
      'view_imports_handlers',
      missing.length === 0,
      missing.length ? `missing handler wiring: ${missing.join(', ')}` : 'handlers imported and called',
      rule?.severity || 'high',
    );
  },

  ui_bindings: (content) =>
    test(
      'ui_bindings',
      /useState/.test(content) && /onChange/.test(content),
      'useState and input onChange handlers',
      'medium',
    ),

  config_keys: (content, meta, rule) => {
    const keys = rule?.keys || meta.configKeys || [];
    if (!keys.length) return test('config_keys', true, 'no config keys required', 'high');
    const missing = keys.filter((k) => !content.includes(k));
    return test(
      'config_keys',
      missing.length === 0,
      missing.length ? `missing keys: ${missing.join(', ')}` : 'config keys present',
      'high',
    );
  },

  schema_fields: (content, meta, rule) => {
    const fields = rule?.fields || meta.fields || [];
    if (!fields.length) return test('schema_fields', true, 'no schema fields', 'high');
    const names = fields.map((f) => f.name || f.id);
    const missing = names.filter((n) => !content.includes(n));
    return test(
      'schema_fields',
      missing.length === 0,
      missing.length ? `missing fields: ${missing.join(', ')}` : 'schema fields present',
      'high',
    );
  },
};

/**
 * Run manifest-declared validation rules for a file.
 */
export function runManifestValidationRules(content, fileMeta = {}) {
  const rules = fileMeta.validationRules || [];
  const actions = fileMeta.manifestActions || fileMeta.actions || [];

  return rules.map((rule) => {
    const checker = CHECKER_REGISTRY[rule.id];
    if (!checker) {
      return test(
        rule.id,
        false,
        'NO CHECKER IMPLEMENTED — rule declared but unenforced',
        rule.severity || 'high',
      );
    }
    const meta = { ...fileMeta, actions };
    const result = checker(content, meta, rule);
    result.severity = rule.severity || result.severity;
    return result;
  });
}
