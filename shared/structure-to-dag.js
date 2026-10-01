/**
 * Convert extracted structure → layered function DAG.
 */

function slugify(str = '') {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 48);
}

export function structureToDAGLayers(structure) {
  if (!structure) return [];

  const uiNodes = [];
  const fnNodes = [];
  const ioNodes = [];
  const rootName = structure.appTitle || 'AppRoot';
  const rootId = slugify(rootName) || 'app_root';

  for (const col of structure.columns || []) {
    uiNodes.push({
      id: col.id,
      name: col.name,
      type: 'ui',
      desc: col.desc || `${col.type} panel`,
      layer: 'ui',
      edges: [],
      region: col.source,
    });
  }

  for (const part of structure.parts || []) {
    const paramIds = (part.params || []).map((p) => p.id);
    fnNodes.push({
      id: part.id,
      name: part.name,
      type: 'fn',
      desc: `Part logic: ${part.name}`,
      layer: 'fn',
      edges: paramIds,
      params: part.params || [],
    });
  }

  for (const p of structure.params || []) {
    if (fnNodes.find((n) => n.id === p.id)) continue;
    fnNodes.push({
      id: p.id,
      name: p.label,
      type: 'fn',
      desc: `Parameter ${p.label} default ${p.value}`,
      layer: 'fn',
      edges: [],
      params: [p],
    });
  }

  for (const act of structure.actions || []) {
    fnNodes.push({
      id: act.id,
      name: act.name,
      type: 'fn',
      desc: `Action handler: ${act.name}`,
      layer: 'fn',
      edges: [rootId],
      action: true,
    });
  }

  if (structure.codeSnippet) {
    ioNodes.push({
      id: 'code_editor',
      name: 'Code Editor',
      type: 'io',
      desc: 'Live code / script surface',
      layer: 'io',
      edges: fnNodes.slice(0, 3).map((n) => n.id),
      snippet: structure.codeSnippet.slice(0, 2000),
    });
  }

  const exportId = structure.domain === 'cad-stl' ? 'stl_export' : 'api_export';
  ioNodes.push({
    id: exportId,
    name: structure.domain === 'cad-stl' ? 'STL Export' : 'Output Bundle',
    type: 'io',
    desc: 'Generated artifact output',
    layer: 'io',
    edges: fnNodes.map((n) => n.id).slice(0, 5),
  });

  const root = {
    id: rootId,
    name: rootName,
    type: 'root',
    desc: `Root capability for ${rootName}`,
    layer: 'root',
    edges: fnNodes.map((n) => n.id),
    domain: structure.domain,
  };

  // Wire UI → nearest fn edges
  if (uiNodes.length && fnNodes.length) {
    uiNodes.forEach((ui, i) => {
      ui.edges = [fnNodes[i % fnNodes.length].id];
    });
  }

  const layers = [];
  if (uiNodes.length) layers.push({ label: 'UI / Layout', nodes: uiNodes });
  if (fnNodes.length) layers.push({ label: 'Functions / Parts', nodes: fnNodes });
  if (ioNodes.length) layers.push({ label: 'I/O / Artifacts', nodes: ioNodes });
  layers.push({ label: 'Root Capability', nodes: [root] });

  return layers;
}

export function mergeLayers(primary, secondary) {
  if (!secondary?.length) return primary;
  const ids = new Set();
  primary.flatMap((l) => l.nodes).forEach((n) => ids.add(n.id));

  const merged = primary.map((l) => ({ ...l, nodes: [...l.nodes] }));
  for (const layer of secondary) {
    const existing = merged.find((l) => l.label === layer.label);
    const newNodes = (layer.nodes || []).filter((n) => !ids.has(n.id));
    newNodes.forEach((n) => ids.add(n.id));
    if (existing) existing.nodes.push(...newNodes);
    else if (newNodes.length) merged.push({ label: layer.label, nodes: newNodes });
  }
  return merged;
}
