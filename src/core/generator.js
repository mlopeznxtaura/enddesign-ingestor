// generator.js — derives scaffold artifacts from DAG layers
// Outputs: React components, prompt.md, dag.json, task_status.json

/**
 * Main entry.
 * @param {Array} layers - from parser.parseDesignToDAG()
 * @param {string} target - 'react' | 'prompt' | 'dag_json' | 'task_json' | 'full'
 * @returns {Array} components — each has { title, type, badge, badgeColor, triggers, code }
 */
export function generateComponents(layers, target = 'full') {
  const allNodes = layers.flatMap(l => l.nodes)
  const uiNodes = allNodes.filter(n => n.type === 'ui')
  const fnNodes = allNodes.filter(n => n.type === 'fn')
  const ioNodes = allNodes.filter(n => n.type === 'io')
  const root = allNodes.find(n => n.type === 'root') || { id: 'root', name: 'SystemRoot' }

  const components = []

  if (target === 'react' || target === 'full') {
    components.push(...reactComponents(uiNodes, fnNodes))
  }

  if (target === 'prompt' || target === 'full') {
    components.push(promptMd(fnNodes, root))
  }

  if (target === 'dag_json' || target === 'full') {
    components.push(dagJson(allNodes, root))
  }

  if (target === 'task_json' || target === 'full') {
    components.push(taskStatusJson(fnNodes, root, allNodes))
  }

  return components
}

// ── REACT COMPONENTS ────────────────────────────────────────────────────
function reactComponents(uiNodes, fnNodes) {
  return uiNodes.slice(0, 5).map(node => {
    const fnName = pascalCase(node.name)
    const handlerFn = fnNodes[0]?.name ? camelCase(fnNodes[0].name) : 'handleAction'
    const mappedFn = fnNodes[0]?.id || 'handler'

    return {
      title: `<${fnName} />`,
      type: 'react',
      badge: 'REACT',
      badgeColor: '#f59e0b',
      triggers: [
        { label: 'onClick', value: `handle${fnName}Click()` },
        { label: 'maps to', value: mappedFn },
        { label: 'state hook', value: `use${fnName}State()` },
      ],
      code: highlight(`const ${fnName} = ({ onAction }) => {
  const [state, setState] = useState(null);

  const handleClick = async () => {
    // → maps to: ${mappedFn}
    const result = await onAction({ node: "${node.id}" });
    setState(result);
  };

  return <button onClick={handleClick}>${node.name}</button>;
};`),
      raw: `const ${fnName} = ({ onAction }) => {
  const [state, setState] = useState(null)
  const handleClick = async () => {
    const result = await onAction({ node: "${node.id}" })
    setState(result)
  }
  return <button onClick={handleClick}>${node.name}</button>
}`
    }
  })
}

// ── PROMPT.MD ──────────────────────────────────────────────────────────
function promptMd(fnNodes, root) {
  const taskLines = fnNodes.slice(0, 8)
    .map((n, i) => `- [ ] ${i + 1}. ${n.name}${n.desc ? ': ' + n.desc.substring(0, 50) : ''}`)
    .join('\n')

  const raw = `# prompt.md — generated from EndDesign
# Root: ${root.name}
# Generated: ${new Date().toISOString()}

## Context
This prompt drives an autonomous agent loop.
Read task_status.json before each task. Write result back when done.

## Tasks
${taskLines}

## Loop Rule
Repeat until all tasks marked [x] done.
On each iteration:
1. Read task_status.json
2. Find first task with status: "pending"
3. Execute it
4. Write result + hash to task_status.json
5. If all done -> emit DONE signal and stop

## Constraints
- Never skip a task without logging the reason
- On error: increment retries, mark BLOCKED after 3
- Hash all outputs before writing status`

  return {
    title: 'prompt.md',
    type: 'prompt',
    badge: 'AGENT',
    badgeColor: '#00e5a0',
    triggers: [
      { label: 'loop', value: 'repeat until all tasks done' },
      { label: 'gate', value: 'check task_status.json before each task' },
      { label: 'root', value: root.name },
    ],
    code: highlight(raw),
    raw,
  }
}

// ── DAG.JSON ───────────────────────────────────────────────────────────
function dagJson(allNodes, root) {
  const nodeList = allNodes.map(n => ({
    id: n.id,
    name: n.name,
    type: n.type,
    layer: n.layer,
    desc: n.desc || '',
    edges: n.edges || [],
  }))

  const triggerMap = {}
  allNodes.filter(n => n.type === 'ui').forEach(n => {
    const target = n.edges?.[0] || root.id
    triggerMap[n.id] = { event: 'onClick', maps_to: target }
  })

  const obj = {
    version: '1.0',
    generated: new Date().toISOString(),
    root: root.id,
    nodes: nodeList,
    triggerMap,
  }

  const raw = JSON.stringify(obj, null, 2)

  return {
    title: 'dag.json',
    type: 'dag',
    badge: 'DAG',
    badgeColor: '#a78bfa',
    triggers: [
      { label: 'format', value: 'nodes + edges + triggerMap' },
      { label: 'nodes', value: `${allNodes.length} total` },
      { label: 'entrypoint', value: root.id },
    ],
    code: highlight(raw),
    raw,
  }
}

// ── TASK_STATUS.JSON ────────────────────────────────────────────────────
function taskStatusJson(fnNodes, root, allNodes = [], domain = 'app-ui') {
  const buildNodes = allNodes.length ? allNodes : fnNodes
  const tasks = buildNodes
    .filter((n) => n.type !== 'root')
    .slice(0, 24)
    .map((n) => ({
      id: n.id,
      name: n.name,
      desc: n.desc || '',
      type: n.type,
      status: 'pending',
      hash: null,
      retries: 0,
      result: null,
      updatedAt: null,
    }))

  const obj = {
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
  }

  const raw = JSON.stringify(obj, null, 2)

  return {
    title: 'task_status.json',
    type: 'status',
    badge: 'STATE',
    badgeColor: '#ef4444',
    triggers: [
      { label: 'agent reads', value: 'before each loop iteration' },
      { label: 'agent writes', value: 'on task complete / error' },
      { label: 'tasks', value: `${tasks.length} pending` },
    ],
    code: highlight(raw),
    raw,
  }
}

// ── SYNTAX HIGHLIGHT (lightweight, HTML-safe) ──────────────────────────
function highlight(code) {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // keywords
    .replace(/\b(const|let|var|async|await|return|import|export|from|null|true|false|if|else|for|of|in|function)\b/g, '<span class="kw">$1</span>')
    // strings (double-quoted)
    .replace(/"([^"]*)"/g, '<span class="str">"$1"</span>')
    // comments
    .replace(/(\/\/[^\n]*)/g, '<span class="cm">$1</span>')
    // function-like identifiers followed by (
    .replace(/\b([a-z][a-zA-Z0-9]+)(?=\()/g, '<span class="fn">$1</span>')
    // markdown headings
    .replace(/(^|\n)(#+[^\n]+)/g, '$1<span class="fn">$2</span>')
    // markdown checkboxes
    .replace(/- \[ \]/g, '<span class="kw">- [ ]</span>')
}

// ── UTILS ──────────────────────────────────────────────────────────────
function pascalCase(str = '') {
  return str.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
            .replace(/^./, c => c.toUpperCase())
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, 30) || 'Component'
}

function camelCase(str = '') {
  const p = pascalCase(str)
  return p.charAt(0).toLowerCase() + p.slice(1)
}

/**
 * Export raw artifacts as a downloadable object.
 * @param {Array} layers
 * @param {Array} components
 */
export function buildExportBundle(layers, components) {
  const allNodes = layers.flatMap(l => l.nodes)
  const bundle = {}

  for (const c of components) {
    if (c.raw) {
      bundle[c.title] = c.raw
    }
  }

  bundle['dag.json'] = bundle['dag.json'] || JSON.stringify({
    version: '1.0',
    generated: new Date().toISOString(),
    nodes: allNodes,
  }, null, 2)

  return bundle
}
