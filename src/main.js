// main.js — app entry, wires DOM to core modules
import { SAMPLES } from './data/samples.js'
import { parseDesignToDAG } from './core/parser.js'
import { generateComponents, buildExportBundle } from './core/generator.js'
import {
  renderDAG,
  renderComponents,
  renderNodeOutput,
  setNodeSelectHandler,
  setLoading,
  setStatus,
  clearOutput,
} from './core/renderer.js'
import { downloadText, downloadBundle } from './core/exporter.js'
import { writeTaskStatus } from './core/task-status.js'
import { connectProvider } from './core/oauth.js'
import { handleCallback, getToken } from './core/oauth-callback.js'
import { revokeToken } from './core/oauth-revoke.js'
import { syncStatus } from './core/status-sync.js'
import { checkGate } from './core/workflow-gate.js'
import { expireCredentials, setupWindowCloseExpiry } from './core/credential-lifetime.js'
import { initBuildUI, getBuildState, addGeneratedFile, setTotalTasks } from './cli/build-ui.js'

// ── STATE ─────────────────────────────────────────────────────────────
let currentLayers = []
let currentComponents = []
let pipelineContext = { domain: 'app-ui', taskPlan: null, fidelity: null }
let pendingImage = null
let statusPollers = {}

// ── BOOT ──────────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = buildLayout()

// Setup credential expiry on window close
setupWindowCloseExpiry()

// Initialize build UI
initBuildUI()

// Wire node select → show node output in right panel
setNodeSelectHandler(node => {
  renderNodeOutput(node, currentComponents)
})

// ── TASK STATUS WRITER ─────────────────────────────────────────────────
export function onProviderConnect(providerId) {
  writeTaskStatus({
    event: 'provider_connect',
    provider: providerId,
    timestamp: new Date().toISOString()
  })
}

export function onProviderRevoke(providerId) {
  writeTaskStatus({
    event: 'provider_revoke',
    provider: providerId,
    timestamp: new Date().toISOString()
  })
}

// ── OAUTH HANDLERS ─────────────────────────────────────────────────────
export async function handleOAuthConnect(providerId, scopes = []) {
  try {
    await connectProvider(providerId, scopes)
    onProviderConnect(providerId)
  } catch (error) {
    console.error('OAuth connect error:', error)
  }
}

export async function handleOAuthCallback(providerId, code, state) {
  try {
    const result = await handleCallback(providerId, code, state)
    startStatusPolling(providerId)
    return result
  } catch (error) {
    console.error('OAuth callback error:', error)
    throw error
  }
}

export async function handleOAuthRevoke(providerId) {
  try {
    await revokeToken(providerId)
    stopStatusPolling(providerId)
    onProviderRevoke(providerId)
  } catch (error) {
    console.error('OAuth revoke error:', error)
  }
}

export async function handleOAuthDisconnect(providerId) {
  await handleOAuthRevoke(providerId)
}

// ── STATUS POLLING ─────────────────────────────────────────────────────
export function startStatusPolling(providerId) {
  if (statusPollers[providerId]) return
  const stop = syncStatus(providerId, { interval: 30000 })
  statusPollers[providerId] = stop
}

export function stopStatusPolling(providerId) {
  if (statusPollers[providerId]) {
    statusPollers[providerId]()
    delete statusPollers[providerId]
  }
}

// ── WORKFLOW GATE ──────────────────────────────────────────────────────
export function checkWorkflowGate(requiredProviders = ['google']) {
  return checkGate(requiredProviders)
}

// ── CREDENTIAL EXPIRY ──────────────────────────────────────────────────
export function handleCredentialExpiry() {
  expireCredentials()
}

// ── INGEST ─────────────────────────────────────────────────────────────
async function ingest() {
  const text = document.getElementById('designInput').value.trim()
  const type = document.getElementById('designType').value
  const target = document.getElementById('outputTarget').value

  if (!text && !pendingImage) return

  setLoading(true)
  setStatus('Extracting structure…')

  let pipelineOk = false
  try {
    const body = { type, useIbm: true }
    if (pendingImage) {
      body.image = pendingImage.data
      body.imageMime = pendingImage.mime
    } else {
      body.text = text
    }

    const res = await fetch('/api/pipeline/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.layers?.length) {
        currentLayers = data.layers
        pipelineContext = {
          domain: data.domain || 'app-ui',
          taskPlan: data.taskPlan,
          fidelity: data.fidelity,
          structure: data.structure,
          manifest: data.manifest,
          pipeline: data.pipeline || 'legacy',
          pipelineStats: data.pipelineStats,
        }
        window.pipelineContext = pipelineContext
        window.pipelineTaskPlan = data.taskPlan
        window.pipelineManifest = data.manifest
        pipelineOk = true
        const fid = data.fidelity?.score != null ? ` fidelity ${data.fidelity.score}%` : ''
        const pipe = data.pipeline && data.pipeline !== 'legacy' ? ` [${data.pipeline}]` : ''
        const manifestN = data.manifest?.files?.length ? ` manifest ${data.manifest.files.length} files` : ''
        let statusMsg = `Pipeline mapped DAG [${data.domain}]${pipe}${manifestN}${fid} (${data.source})`
        if (data.warnings?.length) {
          statusMsg += ` — WARN: ${data.warnings[0]}`
          console.warn('Ingest warnings:', data.warnings)
        }
        setStatus(statusMsg)
      }
    }
  } catch (e) {
    console.warn('Pipeline ingest fallback:', e.message)
  }

  if (!pipelineOk) {
    currentLayers = parseDesignToDAG(text, type)
    pipelineContext = { domain: 'app-ui', taskPlan: null, fidelity: null }
    setStatus('Local parser mapped DAG')
  }

  if (!currentLayers.length) {
    setStatus('Ingest failed — paste full HTML or drop image')
    setLoading(false)
    return
  }

  if (pipelineContext.fidelity?.score != null && pipelineContext.fidelity.score < 40) {
    setStatus(`Low fidelity ${pipelineContext.fidelity.score}% — check input is full HTML mockup`)
  }

  window.currentLayers = currentLayers
  renderDAG(currentLayers)

  const taskCount = pipelineContext.taskPlan?.tasks?.length
    || currentLayers.flatMap(l => l.nodes || []).filter(n => n.type !== 'root').length
  setTotalTasks(taskCount)

  currentComponents = generateComponents(currentLayers, target)
  renderComponents(currentComponents)
  pendingImage = null
  setLoading(false)
}

// ── EVENT BINDINGS ─────────────────────────────────────────────────────
document.addEventListener('click', e => {
  // Ingest button
  if (e.target.id === 'ingestBtn' || e.target.closest('#ingestBtn')) {
    ingest()
    return
  }

  // Clear button
  if (e.target.id === 'clearBtn') {
    document.getElementById('designInput').value = ''
    pendingImage = null
    setDropZoneImageState(false)
    pipelineContext = { domain: 'app-ui', taskPlan: null, fidelity: null }
    window.pipelineContext = pipelineContext
    window.pipelineTaskPlan = null
    currentLayers = []
    currentComponents = []
    renderDAG([])
    clearOutput()
    return
  }

  // Sample items
  const sample = e.target.closest('.sample-item')
  if (sample) {
    const key = sample.dataset.sample
    if (key === 'aerohub') {
      loadAerohubPerfSample()
    } else if (SAMPLES[key]) {
      pendingImage = null
      setDropZoneImageState(false)
      document.getElementById('designInput').value = SAMPLES[key]
    }
    return
  }

  // Export buttons
  if (e.target.id === 'exportPrompt') {
    const c = currentComponents.find(c => c.type === 'prompt')
    if (c?.raw) downloadText('prompt.md', c.raw)
    return
  }

  if (e.target.id === 'exportDag') {
    const c = currentComponents.find(c => c.type === 'dag')
    if (c?.raw) downloadText('dag.json', c.raw)
    return
  }

  if (e.target.id === 'exportAll') {
    if (currentComponents.length) downloadBundle(currentComponents, currentLayers)
    return
  }
})

const DROP_ACCEPT =
  'image/png,image/jpeg,image/jpg,image/gif,image/webp,image/bmp,.html,.htm,.json,.md,.txt,.png,.jpg,.jpeg,.gif,.webp'

const DROP_TYPE_ACCEPT = {
  html: '.html,.htm,text/html',
  png: 'image/png,.png',
  jpg: 'image/jpeg,image/jpg,.jpg,.jpeg',
  json: '.json,application/json',
  md: '.md,.txt,text/markdown,text/plain',
}

let activeDropType = 'png'

function isImageFile(file) {
  if (!file) return false
  if (file.type?.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || '')
}

function setDropZoneImageState(active) {
  const dz = document.getElementById('dropZone')
  if (dz) dz.classList.toggle('has-image', active)
}

function highlightDropChip(type) {
  activeDropType = type
  document.querySelectorAll('.drop-type-chip').forEach((chip) => {
    chip.classList.toggle('highlight', chip.dataset.dropType === type)
  })
}

function openFilePicker(accept = DROP_ACCEPT) {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = accept
  inp.onchange = e => { if (e.target.files[0]) readFile(e.target.files[0]) }
  inp.click()
}

async function loadAerohubPerfSample() {
  pendingImage = null
  setDropZoneImageState(false)
  document.getElementById('designType').value = 'ui'
  setStatus('Loading AeroHub perf-test HTML…')
  try {
    const res = await fetch('/data/perf-test-aerohub.html')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    document.getElementById('designInput').value = html
    setStatus('Loaded perf-test-aerohub.html — click Ingest & Map')
  } catch (e) {
    console.warn('AeroHub sample fetch failed, using inline fallback', e)
    document.getElementById('designInput').value = SAMPLES.aerohub || ''
    setStatus('Loaded inline AeroHub sample — click Ingest & Map')
  }
}

// Drop zone file handling
document.addEventListener('DOMContentLoaded', () => {
  const dz = document.getElementById('dropZone')
  if (!dz) return

  dz.addEventListener('dragover', e => {
    e.preventDefault()
    dz.classList.add('drag-over')
  })
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'))
  dz.addEventListener('drop', e => {
    e.preventDefault()
    dz.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    readFile(file)
  })
  dz.addEventListener('click', e => {
    if (e.target.closest('.drop-type-chip')) return
    openFilePicker(DROP_ACCEPT)
  })

  dz.querySelectorAll('.drop-type-chip').forEach((chip) => {
    chip.addEventListener('click', e => {
      e.preventDefault()
      e.stopPropagation()
      const type = chip.dataset.dropType
      if (!type) return
      highlightDropChip(type)
      openFilePicker(DROP_TYPE_ACCEPT[type] || DROP_ACCEPT)
    })
  })
})

function readFile(file) {
  if (isImageFile(file)) {
    const reader = new FileReader()
    reader.onload = ev => {
      const mime = file.type || (file.name?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
      pendingImage = {
        data: ev.target.result.replace(/^data:[^;]+;base64,/, ''),
        mime,
        name: file.name,
      }
      setDropZoneImageState(true)
      document.getElementById('designInput').value = `[Image: ${file.name}] — click Ingest & Map to run vision pipeline`
      setStatus(`PNG/image loaded (${file.name}) — click Ingest & Map`)
    }
    reader.readAsDataURL(file)
    return
  }

  const reader = new FileReader()
  reader.onload = ev => {
    pendingImage = null
    setDropZoneImageState(false)
    document.getElementById('designInput').value = ev.target.result
    if (file.name.endsWith('.json')) {
      document.getElementById('designType').value = 'dag'
    } else if (/\.(html?|htm)$/i.test(file.name)) {
      document.getElementById('designType').value = 'ui'
    }
    setStatus(`Loaded ${file.name} — click Ingest & Map`)
  }
  reader.readAsText(file)
}

// ── LAYOUT BUILDER ─────────────────────────────────────────────────────
function buildLayout() {
  return `
<div class="app">
  <header>
    <div class="logo">
      <div class="logo-mark">N</div>
      EndDesign Ingestor <span>/ NextAura</span>
    </div>
    <div class="header-status">
      <div class="dot"></div>
      design-to-function mapper v0.1
    </div>
  </header>

  <div class="main">

    <!-- LEFT: INPUT -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Ingest</span>
        <span class="badge">design source</span>
      </div>
      <div class="panel-body">

        <div class="drop-zone" id="dropZone">
          <div class="drop-icon">⬡</div>
          <div class="drop-label">
            <strong>Drop design file</strong>
            HTML mockup, JSON DAG, or image screenshot
            <div class="drop-types">
              <button type="button" class="drop-type-chip" data-drop-type="html">.html</button>
              <button type="button" class="drop-type-chip highlight" data-drop-type="png">.png</button>
              <button type="button" class="drop-type-chip" data-drop-type="jpg">.jpg</button>
              <button type="button" class="drop-type-chip" data-drop-type="json">.json</button>
              <button type="button" class="drop-type-chip" data-drop-type="md">.md</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="label">Or paste end-design / DAG spec</label>
          <textarea id="designInput" rows="9" placeholder="Paste your design spec here...&#10;&#10;Examples:&#10;- JSON DAG: { nodes: [...], edges: [...] }&#10;- UI description: Dashboard with user table...&#10;- Markdown design doc&#10;- Or load a sample below"></textarea>
        </div>

        <div class="field">
          <label class="label">Design type</label>
          <select id="designType">
            <option value="ui">UI / Screen Design</option>
            <option value="dag">JSON DAG</option>
            <option value="workflow">Workflow / Process</option>
            <option value="api">API Contract</option>
            <option value="freeform">Freeform Description</option>
          </select>
        </div>

        <div class="field">
          <label class="label">Output target</label>
          <select id="outputTarget">
            <option value="full">Full scaffold (all)</option>
            <option value="react">React Components</option>
            <option value="prompt">Agent prompt.md</option>
            <option value="dag_json">DAG JSON (triggerable)</option>
            <option value="task_json">task_status.json</option>
          </select>
        </div>

        <button class="btn btn-primary" id="ingestBtn">⬡ Ingest &amp; Map</button>
        <button class="btn btn-ghost" id="clearBtn">Clear</button>

        <div style="margin-top: 20px;">
          <span class="label">Load sample</span>
          <div class="sample-list">
            <div class="sample-item" data-sample="dashboard"><span class="si-icon">◈</span> SaaS Dashboard UI</div>
            <div class="sample-item" data-sample="agent"><span class="si-icon">◈</span> Agent Loop Workflow</div>
            <div class="sample-item" data-sample="oauth"><span class="si-icon">◈</span> OAuth Provider Flow</div>
            <div class="sample-item" data-sample="qvrm"><span class="si-icon">◈</span> Qvrm Trust Protocol DAG</div>
            <div class="sample-item" data-sample="aerohub"><span class="si-icon">◈</span> AeroHub STL (perf test HTML)</div>
          </div>
        </div>
      </div>
    </div>

    <!-- CENTER: DAG CANVAS -->
    <div class="panel" style="border-right: none;">
      <div class="panel-header">
        <span class="panel-title">Function DAG</span>
        <span class="badge" id="nodeCount">0 nodes</span>
      </div>
      <div class="dag-canvas" id="dagCanvas">
        <div class="dag-empty" id="dagEmpty">
          <div class="dag-empty-icon">⬡</div>
          <div class="dag-empty-text">Ingest a design to see the<br>backwards function map</div>
        </div>
        <div class="loading-bar" id="loadingBar"></div>
        <div class="status-line" id="statusLine"></div>
        <div class="dag-graph" id="dagGraph"></div>
      </div>
    </div>

    <!-- RIGHT: OUTPUT -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Derived Components</span>
        <span class="badge accent" id="compCount">0 generated</span>
      </div>
      <div class="panel-body" id="outputPanel">
        <div class="output-empty">Select a node in the DAG<br>or ingest a design to<br>generate components</div>
      </div>
      <div class="export-bar">
        <button class="btn-export" id="exportPrompt">prompt.md</button>
        <button class="btn-export" id="exportDag">dag.json</button>
        <button class="btn-export primary" id="exportAll">Export All</button>
      </div>
    </div>

  </div>
</div>
`
}
