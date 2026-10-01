/**
 * Merge parameter sprawl (wheel_part_*mm.ts) into single config modules.
 */

import { detectParamSprawl } from './verify-scaffold.js';

function parseParamFromPath(path, prefix) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '');
  const suffix = base.slice(prefix.length + 1);
  const key = suffix
    .replace(/_mm$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, '');
  const camelKey = suffix.replace(/_mm$/, '').replace(/_/g, '_');
  return { key: camelKey, label: suffix.replace(/_/g, ' ') };
}

function defaultForKey(key) {
  const k = key.toLowerCase();
  if (k.includes('diameter') || k.includes('radius')) return 60;
  if (k.includes('width') || k.includes('thickness') || k.includes('bore')) return 8;
  if (k.includes('count') || k.includes('spoke')) return 6;
  if (k.includes('resolution')) return 1024;
  if (k.includes('units')) return 'metric';
  if (k.includes('material')) return 'Permendur';
  if (k.includes('name')) return 'aerohub-part';
  return 0;
}

function buildConfigModule(prefix, entries) {
  const typeName = prefix
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  const fields = entries.map((e) => {
    const def = defaultForKey(e.key);
    const type = typeof def === 'string' ? 'string' : 'number';
    return `  ${e.key}: ${type === 'string' ? `'${def}'` : def},`;
  });
  const labels = entries.map((e) => `  ${e.key}: '${e.label}',`);

  return `/** Consolidated param config — ${prefix} */
export const ${prefix}Defaults = {
${fields.join('\n')}
};

export const ${prefix}Labels = {
${labels.join('\n')}
};

export type ${typeName}Config = typeof ${prefix}Defaults;
`;
}

export function consolidateParamSprawl(files = []) {
  const sprawl = detectParamSprawl(files);
  if (!sprawl.groups.length) return files;

  const removePaths = new Set();
  const newFiles = [...files];

  for (const group of sprawl.groups) {
    const entries = group.files.map((path) => parseParamFromPath(path, group.prefix));
    const configPath = `src/generated/${group.prefix}_config.ts`;
    const content = buildConfigModule(group.prefix, entries);

    for (const p of group.files) removePaths.add(p);

    const idx = newFiles.findIndex((f) => f.path === configPath);
    const entry = {
      path: configPath,
      name: `${group.prefix}_config.ts`,
      content,
      status: 'consolidated',
    };
    if (idx >= 0) newFiles[idx] = entry;
    else newFiles.push(entry);
  }

  return newFiles.filter((f) => !removePaths.has(f.path));
}
