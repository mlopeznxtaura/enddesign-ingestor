/**
 * Build UI Controller
 * Integrates BuildConsole, FileTree, and CodePreview components
 * with the main application UI.
 */

import { zipSync, strToU8 } from 'fflate';
import { scaffoldPackageJson } from '../../shared/stl-templates.js';

// Build state
let buildState = {
  status: 'idle', // idle, running, done, error, blocked
  logs: [],
  currentTask: null,
  completedTasks: 0,
  totalTasks: 0,
  generatedFiles: [],
  selectedFile: null,
  selectedFileContent: null,
  liveFilePath: null,
  autoLive: true,
  sandboxMode: 'code', // code | preview
  stepResults: [],
  repairState: null,
  blockedTask: null,
  allowSkipBlocked: false,
  pipeline: 'legacy',
  manifest: null,
};

// Build process reference
let buildProcess = null;
let statusPoller = null;
const AGENT_API = '/api/agent';
let sandboxPreviewDoc = '';

/**
 * Initialize the build UI
 */
export function initBuildUI() {
  // Add build console container to DOM
  const appContainer = document.querySelector('.app');
  if (appContainer && !document.getElementById('build-console-container')) {
    const consoleContainer = document.createElement('div');
    consoleContainer.id = 'build-console-container';
    consoleContainer.innerHTML = buildConsoleHTML();
    appContainer.appendChild(consoleContainer);

    // Add file tree panel
    const outputPanel = document.getElementById('outputPanel');
    if (outputPanel && !document.getElementById('file-tree-container')) {
      const fileTreeContainer = document.createElement('div');
      fileTreeContainer.id = 'file-tree-container';
      fileTreeContainer.innerHTML = fileTreeHTML();
      outputPanel.insertBefore(fileTreeContainer, outputPanel.firstChild);
    }

    // Add code preview panel
    if (outputPanel && !document.getElementById('code-preview-container')) {
      const codePreviewContainer = document.createElement('div');
      codePreviewContainer.id = 'code-preview-container';
      codePreviewContainer.innerHTML = codePreviewHTML();
      outputPanel.appendChild(codePreviewContainer);
    }

    setupEventListeners();
  }
}

/**
 * Build Console HTML
 */
function buildConsoleHTML() {
  return `
    <div class="build-console-wrapper" data-testid="build-console-wrapper">
      <div class="build-console-header" data-testid="build-console-header">
        <div class="build-console-title">
          <span class="console-icon">⚙️</span>
          <span>Build Console</span>
        </div>
        <div class="build-console-controls">
          <label class="skip-blocked-toggle" title="When off, build halts on critical step failure">
            <input type="checkbox" id="skipBlockedToggle" data-testid="skip-blocked-toggle" ${buildState.allowSkipBlocked ? 'checked' : ''} />
            <span>Skip blocked</span>
          </label>
          <span class="status-badge status-${buildState.status}" data-testid="build-status">
            ${getStatusLabel(buildState.status)}
          </span>
          ${buildState.repairState
            ? `<span class="repair-banner" data-testid="repair-banner">Repair ${escapeHtml(buildState.repairState.path || '')} (${buildState.repairState.attempt}/${buildState.repairState.maxAttempts || 3})</span>`
            : ''}
          ${buildState.blockedTask && buildState.status === 'blocked'
            ? `<span class="blocked-chip" data-testid="blocked-chip">BLOCKED: ${escapeHtml(buildState.blockedTask)}</span>`
            : ''}
          ${buildState.status === 'idle' || buildState.status === 'done' || buildState.status === 'error' || buildState.status === 'blocked'
            ? `<button class="btn btn-start" id="startBuildBtn" data-testid="start-build-button">▶ Start Build</button>`
            : `<button class="btn btn-stop" id="stopBuildBtn" data-testid="stop-build-button">⏹ Stop</button>`
          }
          <button class="btn btn-download" id="downloadScaffoldBtn" data-testid="download-scaffold-button" ${buildState.generatedFiles.length === 0 ? 'disabled' : ''}>
            📥 Download Scaffold
          </button>
          <button class="btn btn-open" id="exportZipBtn" data-testid="export-zip-button" ${buildState.generatedFiles.length === 0 ? 'disabled' : ''}>
            📦 Export Zip
          </button>
        </div>
      </div>
      <div class="build-console-body">
        <div class="build-progress" data-testid="build-progress">
          <div class="progress-info">
            <span class="progress-text">Task ${buildState.completedTasks} of ${buildState.totalTasks || 0}</span>
            <span class="progress-percent">${getProgressPercent()}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${getProgressPercent()}%" data-testid="progress-bar-fill"></div>
          </div>
          <div class="progress-stats">
            <span class="stat" data-testid="file-count">📁 ${buildState.generatedFiles.length} files</span>
            <span class="stat" data-testid="task-progress">📋 ${escapeHtml(buildState.currentTask || 'Waiting...')}${buildState.pipeline && buildState.pipeline !== 'legacy' ? ` · ${buildState.pipeline}` : ''}</span>
          </div>
        </div>
        <div class="build-split-panel" data-testid="build-split-panel">
          <div class="build-logs-column">
            <div class="build-logs" data-testid="build-logs">
              <div class="logs-header">
                <span>📜 Build Logs</span>
                <span class="logs-count">${buildState.logs.length} entries</span>
              </div>
              <div class="logs-content" id="buildLogsContent">
                ${buildState.logs.length === 0 
                  ? '<div class="logs-empty">No logs yet. Start a build to see output.</div>'
                  : buildState.logs.map(log => `
                      <div class="log-entry log-${log.level || 'info'}">
                        <span class="log-timestamp">${formatTimestamp(log.timestamp)}</span>
                        <span class="log-message">${escapeHtml(log.message)}</span>
                      </div>
                    `).join('')
                }
              </div>
            </div>
          </div>
          <div class="live-sandbox-column" data-testid="live-sandbox">
            ${liveSandboxHTML()}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Live sandbox panel — follows codegen in real time
 */
function liveSandboxHTML() {
  const file = getLiveSandboxFile();
  const step = getStepResultForPath(file?.path);
  const isLive = buildState.autoLive && buildState.status === 'running';
  const chips = (step?.tests || []).map((t) => `
    <span class="step-chip ${t.pass ? 'pass' : 'fail'}" title="${escapeHtml(t.message)}">${t.pass ? '✓' : '✗'} ${t.id}</span>
  `).join('');

  return `
    <div class="sandbox-toolbar">
      <span class="sandbox-title">▶ Live Sandbox</span>
      <span class="live-indicator ${isLive ? 'active' : ''}" data-testid="live-indicator">${isLive ? '● LIVE' : '○ PAUSED'}</span>
      <button type="button" class="btn btn-sandbox" id="sandboxRunBtn" data-testid="sandbox-run-button" ${!file ? 'disabled' : ''}>Run</button>
      <button type="button" class="btn btn-sandbox" id="sandboxLiveBtn" data-testid="sandbox-live-button">${buildState.autoLive ? 'Follow: ON' : 'Follow: OFF'}</button>
      <button type="button" class="btn btn-sandbox" id="sandboxCodeBtn" data-testid="sandbox-code-button" ${buildState.sandboxMode === 'code' ? 'disabled' : ''}>Code</button>
    </div>
    <div class="sandbox-meta">
      <span class="sandbox-task" data-testid="sandbox-task">${escapeHtml(buildState.currentTask || 'Waiting for task…')}</span>
      <span class="sandbox-path" data-testid="sandbox-path">${file ? escapeHtml(file.path) : '—'}</span>
      ${file?.status ? `<span class="sandbox-status status-${file.status}">${file.status}</span>` : ''}
    </div>
    <div class="sandbox-step-chips" data-testid="sandbox-step-chips">${chips || '<span class="step-chip idle">step tests pending</span>'}</div>
    <div class="sandbox-body ${buildState.sandboxMode === 'preview' ? 'mode-preview' : 'mode-code'}">
      <pre class="sandbox-code" id="sandboxCode" data-testid="sandbox-code"><code>${file?.content ? escapeHtml(file.content) : '<span class="sandbox-empty">Start build — code appears here as each file is written</span>'}</code></pre>
      <iframe class="sandbox-preview" id="sandboxPreview" data-testid="sandbox-preview" title="Run preview" sandbox="allow-scripts"></iframe>
    </div>
  `;
}

function getLiveSandboxFile() {
  if (buildState.liveFilePath) {
    return buildState.generatedFiles.find((f) => f.path === buildState.liveFilePath);
  }
  if (buildState.selectedFile) {
    return buildState.generatedFiles.find((f) => f.path === buildState.selectedFile);
  }
  return buildState.generatedFiles[buildState.generatedFiles.length - 1];
}

function getStepResultForPath(path) {
  if (!path || !buildState.stepResults?.length) return null;
  return buildState.stepResults.find((s) => s.path === path);
}

function syncLiveFromPoll(data) {
  if (data.stepResults?.length) {
    buildState.stepResults = data.stepResults;
  }

  const logs = data.logs || [];
  const last = logs[logs.length - 1];
  if (last?.message?.startsWith('Wrote file:')) {
    const path = last.message.replace('Wrote file:', '').trim();
    if (buildState.autoLive) buildState.liveFilePath = path;
  }

  const files = data.files || data.generatedFiles || [];
  if (buildState.autoLive && files.length) {
    const byTask = data.currentTask
      ? files.find((f) => f.taskId === data.currentTask || f.path?.includes(data.currentTask))
      : null;
    buildState.liveFilePath = byTask?.path || files[files.length - 1].path;
    buildState.selectedFile = buildState.liveFilePath;
  }
}

function handleSandboxRun() {
  const file = getLiveSandboxFile();
  if (!file?.content) return;
  buildState.sandboxMode = 'preview';

  if (file.path.endsWith('.py')) {
    sandboxPreviewDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Consolas,monospace;padding:16px">
      <h3 style="color:#58a6ff;font-family:system-ui">Python — ${escapeHtml(file.name)}</h3>
      <pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(file.content)}</pre>
      <p style="color:#8b949e;font-family:system-ui;font-size:12px">Export zip → pip install build123d → python ${escapeHtml(file.path)}</p>
    </body></html>`;
  } else {
    const labels = [...file.content.matchAll(/<h[12][^>]*>([^<]+)/gi)].map((m) => m[1].trim()).filter(Boolean);
    const buttons = [...file.content.matchAll(/<button[^>]*>([^<]+)/gi)].map((m) => m[1].trim()).filter(Boolean);
    const uiBits = labels.map((l) => `<div style="padding:10px 12px;border:1px solid #30363d;border-radius:8px;margin:8px 0;background:#161b22">${escapeHtml(l)}</div>`).join('');
    const btnBits = buttons.map((b) => `<button style="margin:4px;padding:6px 12px;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#e6edf3">${escapeHtml(b)}</button>`).join('');
    sandboxPreviewDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0d1117;color:#e6edf3;padding:16px;font-family:system-ui">
      <h3 style="color:#58a6ff;margin:0 0 12px">Preview — ${escapeHtml(file.name)}</h3>
      ${uiBits || '<p style="color:#8b949e">Component scaffold</p>'}
      ${btnBits ? `<div style="margin-top:12px">${btnBits}</div>` : ''}
      <hr style="border-color:#30363d;margin:16px 0"/>
      <pre style="font-size:11px;color:#8b949e;white-space:pre-wrap;max-height:200px;overflow:auto">${escapeHtml(file.content.slice(0, 1200))}</pre>
    </body></html>`;
  }

  renderBuildUI();
  addLog(`Sandbox run: ${file.path}`, 'info');
}

function handleSandboxLiveToggle() {
  buildState.autoLive = !buildState.autoLive;
  renderBuildUI();
}

function handleSandboxCodeView() {
  buildState.sandboxMode = 'code';
  renderBuildUI();
}

/**
 * File Tree HTML
 */
function fileTreeHTML() {
  const files = buildState.generatedFiles;
  return `
    <div class="file-tree-wrapper" data-testid="file-tree-wrapper">
      <div class="file-tree-header">
        <span>📁 Generated Files</span>
        <span class="file-count">${files.length} files</span>
      </div>
      <div class="file-tree-content" data-testid="file-tree-content">
        ${files.length === 0 
          ? '<div class="file-tree-empty">No files generated yet</div>'
          : files.map(file => `
              <div class="file-tree-item ${buildState.selectedFile === file.path ? 'selected' : ''}" 
                   data-path="${escapeHtml(file.path)}"
                   data-testid="file-item">
                <span class="file-icon">${getFileIcon(file.path)}</span>
                <span class="file-name">${escapeHtml(file.name)}</span>
              </div>
            `).join('')
        }
      </div>
    </div>
  `;
}

/**
 * Code Preview HTML
 */
function codePreviewHTML() {
  const selectedFile = buildState.generatedFiles.find(f => f.path === buildState.selectedFile);
  return `
    <div class="code-preview-wrapper" data-testid="code-preview-wrapper">
      <div class="code-preview-header">
        ${selectedFile 
          ? `
            <span class="file-icon">${getFileIcon(selectedFile.path)}</span>
            <span class="file-name">${escapeHtml(selectedFile.name)}</span>
            <span class="language-badge">${getLanguageFromExt(selectedFile.path)}</span>
            `
          : '<span class="no-file">Select a file to preview</span>'
        }
        ${selectedFile 
          ? `<button class="btn-copy" id="copyCodeBtn" data-testid="copy-code-button">📋 Copy</button>`
          : ''
        }
      </div>
      <div class="code-preview-content" data-testid="code-preview-content">
        ${selectedFile?.content 
          ? `<pre><code>${escapeHtml(selectedFile.content)}</code></pre>`
          : '<div class="code-empty">Select a file to view its contents</div>'
        }
      </div>
    </div>
  `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  document.addEventListener('change', (e) => {
    if (e.target.id === 'skipBlockedToggle') {
      handleSkipBlockedToggle(e.target.checked);
    }
  });

  document.addEventListener('click', (e) => {
    // Start Build button
    if (e.target.id === 'startBuildBtn') {
      handleStartBuild();
      return;
    }

    // Stop Build button
    if (e.target.id === 'stopBuildBtn') {
      handleStopBuild();
      return;
    }

    // Download Scaffold button
    if (e.target.id === 'downloadScaffoldBtn') {
      handleDownloadScaffold();
      return;
    }

    // Export Zip button
    if (e.target.id === 'exportZipBtn') {
      handleExportZip();
      return;
    }

    if (e.target.id === 'sandboxRunBtn') {
      handleSandboxRun();
      return;
    }

    if (e.target.id === 'sandboxLiveBtn') {
      handleSandboxLiveToggle();
      return;
    }

    if (e.target.id === 'sandboxCodeBtn') {
      handleSandboxCodeView();
      return;
    }

    // Copy Code button
    if (e.target.id === 'copyCodeBtn') {
      handleCopyCode();
      return;
    }

    // File tree item
    const fileItem = e.target.closest('[data-path]');
    if (fileItem && fileItem.parentElement.classList.contains('file-tree-content')) {
      handleFileSelect(fileItem.dataset.path);
      return;
    }
  });
}

async function handleSkipBlockedToggle(checked) {
  buildState.allowSkipBlocked = checked;
  try {
    await fetch(`${AGENT_API}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowSkipBlocked: checked }),
    });
    addLog(`Skip blocked tasks: ${checked ? 'ON' : 'OFF'}`, 'info');
  } catch (err) {
    addLog(`Config error: ${err.message}`, 'warn');
  }
}

/**
 * Handle Start Build
 */
async function handleStartBuild() {
  addLog('Initializing Agent Bridge connection...', 'info');
  updateBuildStatus('running');
  buildState.autoLive = true;
  buildState.sandboxMode = 'code';
  buildState.liveFilePath = null;
  buildState.stepResults = [];

  const layers = getCurrentDAG();
  if (!layers.length) {
    addLog('No DAG loaded — ingest a design first', 'warn');
    updateBuildStatus('error');
    return;
  }

  const nodeCount = layers.flatMap((l) => l.nodes || []).filter((n) => n.type !== 'root').length;
  if (nodeCount < 2) {
    addLog('DAG too small — re-ingest full HTML mockup before build', 'warn');
    updateBuildStatus('error');
    return;
  }

  try {
    const response = await fetch(`${AGENT_API}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layers,
        resume: true,
        target: 'react',
        taskPlan: window.pipelineTaskPlan || null,
        domain: window.pipelineContext?.domain || 'app-ui',
        fidelity: window.pipelineContext?.fidelity || null,
        allowSkipBlocked: buildState.allowSkipBlocked,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to start agent API');
    }

    addLog('Agent process spawned successfully', 'success');
    buildState.logs = [];
    startStatusPolling();

    buildProcess = {
      stop: () => {
        stopStatusPolling();
        fetch(`${AGENT_API}/stop`, { method: 'POST' });
      },
    };
  } catch (error) {
    addLog(`Agent error: ${error.message}`, 'error');
    updateBuildStatus('error');
  }
}

function startStatusPolling() {
  stopStatusPolling();
  let lastLogCount = 0;

  statusPoller = setInterval(async () => {
    try {
      const res = await fetch(`${AGENT_API}/status`);
      if (!res.ok) return;
      const data = await res.json();

      if (data.totalTasks) {
        buildState.totalTasks = data.totalTasks;
      }
      if (data.completedTasks !== undefined) {
        buildState.completedTasks = data.completedTasks;
      }
      if (data.currentTask) {
        buildState.currentTask = data.currentTask;
      }

      if (data.repairState) {
        buildState.repairState = data.repairState;
      } else if (buildState.status !== 'running') {
        buildState.repairState = null;
      }
      if (data.blockedTask !== undefined) {
        buildState.blockedTask = data.blockedTask;
      }
      if (data.allowSkipBlocked !== undefined) {
        buildState.allowSkipBlocked = data.allowSkipBlocked;
      }

      if (data.pipeline) {
        buildState.pipeline = data.pipeline;
      }
      if (data.manifest) {
        buildState.manifest = data.manifest;
      }

      const logs = data.logs || [];
      if (logs.length > lastLogCount) {
        for (let i = lastLogCount; i < logs.length; i++) {
          const log = logs[i];
          buildState.logs.push({
            id: Date.now() + Math.random(),
            message: log.message,
            level: log.level || 'info',
            timestamp: log.timestamp,
          });
          if (buildState.autoLive && log.message?.startsWith('Wrote file:')) {
            buildState.liveFilePath = log.message.replace('Wrote file:', '').trim();
            buildState.selectedFile = buildState.liveFilePath;
          }
        }
        lastLogCount = logs.length;
      }

      syncLiveFromPoll(data);

      const files = data.files || data.generatedFiles || [];
      if (files.length) {
        buildState.generatedFiles = files;
      }

      if (data.status === 'running') {
        buildState.status = 'running';
      } else if (data.status === 'done') {
        updateBuildStatus('done');
        stopStatusPolling();
        buildState.repairState = null;
        if (data.fidelity) {
          window.pipelineContext = { ...window.pipelineContext, buildFidelity: data.fidelity };
        }
        if (data.verification) {
          window.pipelineContext = { ...window.pipelineContext, verification: data.verification };
        }
        if (data.stepResults) {
          window.pipelineContext = {
            ...window.pipelineContext,
            stepResults: data.stepResults,
            stepSummary: data.stepSummary,
          };
        }
      } else if (data.status === 'error') {
        updateBuildStatus('error');
        stopStatusPolling();
        buildState.repairState = null;
      } else if (data.status === 'blocked') {
        updateBuildStatus('blocked');
        stopStatusPolling();
        addLog(`Build blocked at task: ${data.blockedTask || 'unknown'}`, 'error');
      } else if (data.status === 'idle' && buildState.status === 'running') {
        updateBuildStatus('idle');
        stopStatusPolling();
      }

      renderBuildUI();
    } catch (err) {
      console.error('Status poll error:', err);
    }
  }, 600);
}

function stopStatusPolling() {
  if (statusPoller) {
    clearInterval(statusPoller);
    statusPoller = null;
  }
}

/**
 * Handle Stop Build
 */
function handleStopBuild() {
  if (buildProcess?.stop) {
    buildProcess.stop();
    addLog('Stopping build process...', 'warn');
  }
  stopStatusPolling();
  updateBuildStatus('idle');
}

/**
 * Fetch latest generated files from agent API or local state.
 */
async function fetchGeneratedFiles() {
  let files = buildState.generatedFiles;
  try {
    const res = await fetch(`${AGENT_API}/status`);
    if (res.ok) {
      const data = await res.json();
      if (data.files?.length) {
        files = data.files;
        buildState.generatedFiles = files;
      }
    }
  } catch {
    // use local state
  }
  return files;
}

/**
 * Handle Download Scaffold (JSON bundle)
 */
async function handleDownloadScaffold() {
  const files = await fetchGeneratedFiles();

  if (files.length === 0) {
    addLog('No files to download', 'warn');
    return;
  }

  const bundle = {
    files,
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    domain: window.pipelineContext?.domain || 'app-ui',
    fidelity: window.pipelineContext?.fidelity || null,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scaffold-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  addLog(`Downloaded ${files.length} files (JSON)`, 'success');
}

/**
 * Handle Export Zip — downloadable project folder
 */
async function handleExportZip() {
  const files = await fetchGeneratedFiles();

  if (files.length === 0) {
    addLog('No files to export — run a build first', 'warn');
    return;
  }

  try {
    const domain = window.pipelineContext?.domain || 'app-ui';
    const buildFidelity = window.pipelineContext?.buildFidelity;
    const verification = window.pipelineContext?.verification;
    const stepSummary = window.pipelineContext?.stepSummary;
    const meta = {
      generator: 'EndDesign Ingestor',
      pipeline: window.pipelineContext?.pipeline || buildState.pipeline || 'legacy',
      domain,
      manifest: window.pipelineManifest || buildState.manifest || window.pipelineContext?.manifest || null,
      fidelity: buildFidelity || window.pipelineContext?.fidelity || null,
      structureFidelity: window.pipelineContext?.fidelity || null,
      verification: verification
        ? { compileScore: verification.compileScore, issues: verification.issues, ok: verification.ok }
        : null,
      stepSummary: stepSummary || null,
      stepResults: window.pipelineContext?.stepResults || null,
      timestamp: new Date().toISOString(),
      totalFiles: files.length,
      files: files.map((f) => f.path),
    };

    const zipEntries = {};
    zipEntries['scaffold-meta.json'] = strToU8(JSON.stringify(meta, null, 2));
    zipEntries['package.json'] = strToU8(scaffoldPackageJson(domain));
    zipEntries['README.md'] = strToU8(
      `# EndDesign Scaffold\n\nDomain: ${domain}\nSource files: ${files.length}\nHonest fidelity: ${meta.fidelity?.score ?? 'n/a'}%\nGenerated: ${meta.timestamp}\n\nRun: npm install && npm run dev\n`,
    );

    for (const file of files) {
      const path = (file.path || file.name || 'unknown.txt').replace(/^\/+/, '');
      if (!path || zipEntries[path]) continue;
      zipEntries[path] = strToU8(file.content || '');
    }

    const zipped = zipSync(zipEntries);
    const blob = new Blob([zipped], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scaffold-${domain}-${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    addLog(`Exported ${files.length} source files as ZIP (+ scaffold-meta.json)`, 'success');
  } catch (err) {
    addLog(`ZIP export failed: ${err.message}`, 'error');
  }
}

/**
 * Handle Copy Code
 */
async function handleCopyCode() {
  const selectedFile = buildState.generatedFiles.find(f => f.path === buildState.selectedFile);
  if (selectedFile?.content) {
    try {
      await navigator.clipboard.writeText(selectedFile.content);
      addLog('Code copied to clipboard', 'success');
      // Update button text temporarily
      const btn = document.getElementById('copyCodeBtn');
      if (btn) {
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
      }
    } catch (err) {
      addLog('Failed to copy code', 'error');
    }
  }
}

/**
 * Handle File Select
 */
function handleFileSelect(filePath) {
  buildState.selectedFile = filePath;
  const file = buildState.generatedFiles.find(f => f.path === filePath);
  if (file) {
    addLog(`Selected file: ${file.name}`, 'info');
  }
  renderBuildUI();
}

/**
 * Simulate build process
 */
function simulateBuild(dagData) {
  const process = { stop: false };
  let index = 0;

  const interval = setInterval(() => {
    if (process.stop || index >= dagData.length) {
      clearInterval(interval);
      if (!process.stop) {
        updateBuildStatus('done');
        addLog('Build complete!', 'success');
      }
      return;
    }

    const node = dagData[index];
    updateBuildState({
      currentTask: node.id || node.name || `Task ${index + 1}`,
      completedTasks: index + 1,
    });

    // Simulate file generation
    const newFile = {
      path: `src/generated/${node.id || `file_${index}`}.ts`,
      name: `${node.id || `file_${index}`}.ts`,
      content: `// Generated file for ${node.id || node.name}\nexport const data = ${JSON.stringify(node, null, 2)};`,
      status: 'generated',
    };

    buildState.generatedFiles.push(newFile);
    addLog(`Generated: ${newFile.name}`, 'success');
    renderBuildUI();

    index++;
  }, 500);

  return process;
}

/**
 * Update build status
 */
function updateBuildStatus(status) {
  buildState.status = status;
  renderBuildUI();
}

/**
 * Update build state
 */
function updateBuildState(updates) {
  Object.assign(buildState, updates);
  renderBuildUI();
}

/**
 * Add log entry
 */
function addLog(message, level = 'info') {
  buildState.logs.push({
    id: Date.now() + Math.random(),
    message,
    level,
    timestamp: new Date().toISOString(),
  });
  renderBuildUI();
}

/**
 * Get current DAG data
 */
function getCurrentDAG() {
  // Try to get DAG from existing state
  if (window.currentLayers) {
    return window.currentLayers;
  }
  return [];
}

/**
 * Render build UI
 */
function renderBuildUI() {
  const consoleContainer = document.getElementById('build-console-container');
  const fileTreeContainer = document.getElementById('file-tree-container');
  const codePreviewContainer = document.getElementById('code-preview-container');

  if (consoleContainer) {
    consoleContainer.innerHTML = buildConsoleHTML();
    scrollBuildLogsToEnd();
    const iframe = document.getElementById('sandboxPreview');
    if (iframe && buildState.sandboxMode === 'preview' && sandboxPreviewDoc) {
      iframe.srcdoc = sandboxPreviewDoc;
    }
  }
  if (fileTreeContainer) {
    fileTreeContainer.innerHTML = fileTreeHTML();
  }
  if (codePreviewContainer) {
    codePreviewContainer.innerHTML = codePreviewHTML();
  }
}

/**
 * Helper: Get status label
 */
function getStatusLabel(status) {
  const labels = {
    idle: 'Idle',
    running: 'Running',
    done: 'Complete',
    error: 'Error',
    paused: 'Paused',
    blocked: 'Blocked',
  };
  return labels[status] || 'Unknown';
}

/**
 * Helper: Get progress percent
 */
function getProgressPercent() {
  if (buildState.totalTasks === 0) return 0;
  return Math.round((buildState.completedTasks / buildState.totalTasks) * 100);
}

/**
 * Helper: Format timestamp
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function scrollBuildLogsToEnd() {
  const el = document.getElementById('buildLogsContent');
  if (el) el.scrollTop = el.scrollHeight;
}

/**
 * Helper: Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Helper: Get file icon
 */
function getFileIcon(filePath) {
  const ext = filePath?.split('.').pop().toLowerCase();
  const icons = {
    js: '📜',
    jsx: '⚛️',
    ts: '📘',
    tsx: '⚛️',
    py: '🐍',
    rs: '🦀',
    json: '📋',
    md: '📝',
    css: '🎨',
    html: '🌐',
    toml: '⚙️',
  };
  return icons[ext] || '📄';
}

/**
 * Helper: Get language from extension
 */
function getLanguageFromExt(filePath) {
  const ext = filePath?.split('.').pop().toLowerCase();
  const langs = {
    js: 'JavaScript',
    jsx: 'React',
    ts: 'TypeScript',
    tsx: 'React TS',
    py: 'Python',
    rs: 'Rust',
    json: 'JSON',
    md: 'Markdown',
    css: 'CSS',
    html: 'HTML',
    toml: 'TOML',
  };
  return langs[ext] || 'Text';
}

/**
 * Add file to build state
 */
export function addGeneratedFile(file) {
  buildState.generatedFiles.push(file);
  renderBuildUI();
}

/**
 * Set total tasks
 */
export function setTotalTasks(count) {
  buildState.totalTasks = count;
  renderBuildUI();
}

/**
 * Get build state
 */
export function getBuildState() {
  return { ...buildState };
}
