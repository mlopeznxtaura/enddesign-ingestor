// renderer.js — pure DOM rendering, no framework dependency

let onNodeSelect = null

export function setNodeSelectHandler(fn) {
  onNodeSelect = fn
}

// ── DAG RENDERER ─────────────────────────────────────────────────────
export function renderDAG(layers) {
  const graph = document.getElementById('dagGraph')
  const empty = document.getElementById('dagEmpty')
  const nodeCount = document.getElementById('nodeCount')

  graph.innerHTML = ''

  const hasNodes = layers && layers.some(l => l.nodes.length > 0)

  if (!hasNodes) {
    graph.classList.remove('visible')
    empty.style.display = 'flex'
    nodeCount.textContent = '0 nodes'
    return
  }

  empty.style.display = 'none'
  graph.classList.add('visible')

  const total = layers.reduce((s, l) => s + l.nodes.length, 0)
  nodeCount.textContent = `${total} nodes`

  // Render bottom-up: root at bottom, UI at top
  const reversed = [...layers].reverse()

  reversed.forEach((layer, li) => {
    const layerEl = document.createElement('div')
    layerEl.className = 'dag-layer'

    const labelEl = document.createElement('div')
    labelEl.className = 'dag-layer-label'
    labelEl.textContent = layer.label
    layerEl.appendChild(labelEl)

    const rowEl = document.createElement('div')
    rowEl.className = 'dag-row'

    layer.nodes.forEach(node => {
      const nodeEl = document.createElement('div')
      nodeEl.className = `dag-node type-${node.type}`
      nodeEl.dataset.nodeId = node.id
      nodeEl.innerHTML = `
        <div class="node-type">${node.type}</div>
        <div class="node-name">${node.name}</div>
        ${node.desc ? `<div class="node-desc">${node.desc.substring(0, 55)}${node.desc.length > 55 ? '…' : ''}</div>` : ''}
      `
      nodeEl.addEventListener('click', () => {
        document.querySelectorAll('.dag-node').forEach(n => n.classList.remove('selected'))
        nodeEl.classList.add('selected')
        if (onNodeSelect) onNodeSelect(node)
      })
      rowEl.appendChild(nodeEl)
    })

    layerEl.appendChild(rowEl)

    if (li < reversed.length - 1) {
      const arrow = document.createElement('div')
      arrow.className = 'dag-arrow'
      arrow.textContent = 'v'
      layerEl.appendChild(arrow)
    }

    graph.appendChild(layerEl)
  })
}

// ── COMPONENT RENDERER ─────────────────────────────────────────────────
export function renderComponents(components) {
  const panel = document.getElementById('outputPanel')
  const count = document.getElementById('compCount')

  count.textContent = `${components.length} generated`

  if (!components.length) {
    panel.innerHTML = '<div class="output-empty">No components generated.<br>Check design input.</div>'
    return
  }

  panel.innerHTML = components.map(renderComponentCard).join('')
}

export function renderNodeOutput(node, components) {
  const panel = document.getElementById('outputPanel')

  const nodeCard = `
    <div class="component-card">
      <div class="cc-header">
        <div class="cc-title">
          <span style="color:${typeColor(node.type)}">◈</span>
          ${node.name}
        </div>
        <span class="badge">${node.type.toUpperCase()}</span>
      </div>
      <div class="cc-body">
        <div class="trigger-map">
          ${triggerRow('node id', node.id)}
          ${triggerRow('layer', node.layer || node.type)}
          ${node.desc ? triggerRow('context', node.desc) : ''}
          ${triggerRow('trigger', triggerLabel(node.type))}
          ${(node.edges || []).length ? triggerRow('edges ->', node.edges.join(', ')) : ''}
        </div>
      </div>
    </div>
  `

  panel.innerHTML = nodeCard + components.map(renderComponentCard).join('')
}

function renderComponentCard(c) {
  return `
    <div class="component-card">
      <div class="cc-header">
        <div class="cc-title">
          <span style="color:${c.badgeColor}">◈</span>
          ${c.title}
        </div>
        <span class="badge" style="color:${c.badgeColor};border-color:${c.badgeColor}33;background:${c.badgeColor}11">${c.badge}</span>
      </div>
      <div class="cc-body">
        <div class="trigger-map">
          ${(c.triggers || []).map(t => triggerRow(t.label, t.value)).join('')}
        </div>
        <div class="code-block">${c.code}</div>
      </div>
    </div>
  `
}

function triggerRow(label, value) {
  return `
    <div class="trigger-row">
      <span class="trigger-arrow">-></span>
      <span class="trigger-label">${label}</span>
      <span class="trigger-value">${value}</span>
    </div>
  `
}

function typeColor(type) {
  return { ui: '#f59e0b', fn: '#a78bfa', root: '#00e5a0', io: '#ef4444' }[type] || '#5a5a6e'
}

function triggerLabel(type) {
  return {
    ui: 'onClick handler -> function layer',
    fn: 'function call -> I/O layer',
    io: 'data boundary -> root',
    root: 'root capability (entrypoint)',
  }[type] || 'maps to handler'
}

// ── STATUS HELPERS ──────────────────────────────────────────────────────
export function setLoading(active) {
  document.getElementById('loadingBar').classList.toggle('active', active)
  document.getElementById('statusLine').classList.toggle('visible', active)
}

export function setStatus(msg) {
  const el = document.getElementById('statusLine')
  el.textContent = msg
}

export function clearOutput() {
  document.getElementById('outputPanel').innerHTML =
    '<div class="output-empty">Select a node in the DAG<br>or ingest a design to<br>generate components</div>'
  document.getElementById('compCount').textContent = '0 generated'
  document.getElementById('nodeCount').textContent = '0 nodes'
}
