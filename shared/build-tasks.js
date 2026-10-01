/**
 * Build task plan from DAG layers (mirrors task_status.json shape).
 */

export function layersToTaskPlan(layers = [], domain = 'app-ui') {
  const all = layers.flatMap((l) => l.nodes || []);
  const root = all.find((n) => n.type === 'root') || { id: 'app_root', name: 'AppRoot' };

  const seen = new Set();
  const tasks = [];

  const add = (node, kind) => {
    if (!node?.id || seen.has(node.id)) return;
    seen.add(node.id);
    tasks.push({
      id: node.id,
      name: node.name,
      desc: node.desc || '',
      type: node.type,
      kind,
      status: 'pending',
      hash: null,
      retries: 0,
      result: null,
      updatedAt: null,
      params: node.params || [],
      domain,
    });
  };

  // Shell first
  const uiNodes = all.filter((n) => n.type === 'ui');
  uiNodes.forEach((n) => add(n, 'ui-component'));

  // Part / function logic
  const fnNodes = all.filter((n) => n.type === 'fn');
  fnNodes.forEach((n) => add(n, 'handler'));

  // I/O artifacts
  const ioNodes = all.filter((n) => n.type === 'io');
  ioNodes.forEach((n) => add(n, 'io-artifact'));

  // App entry
  add(root, 'app-shell');

  return {
    version: '1.0',
    generated: new Date().toISOString(),
    meta: {
      root: root.id,
      rootName: root.name,
      domain,
      loopActive: false,
      completedAt: null,
    },
    tasks,
  };
}

export function taskPlanToBuildNodes(taskPlan) {
  return (taskPlan?.tasks || []).map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type || 'fn',
    desc: t.desc,
    params: t.params,
    kind: t.kind,
  }));
}

export function dedupeNodes(nodes) {
  const seen = new Set();
  return nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}
