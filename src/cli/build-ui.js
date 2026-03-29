/**
 * Build UI Controller
 * Integrates BuildConsole, FileTree, and CodePreview components
 * with the main application UI.
 */

// Build state
let buildState = {
  status: 'idle', // idle, running, done, error
  logs: [],
  currentTask: null,
  completedTasks: 0,
  totalTasks: 0,
  generatedFiles: [],
  selectedFile: null,
  selectedFileContent: null,
};

// Build process reference
let buildProcess = null;

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
          <span class="status-badge status-${buildState.status}" data-testid="build-status">
            ${getStatusLabel(buildState.status)}
          </span>
          ${buildState.status === 'idle' || buildState.status === 'done' || buildState.status === 'error' 
            ? `<button class="btn btn-start" id="startBuildBtn" data-testid="start-build-button">▶ Start Build</button>`
            : `<button class="btn btn-stop" id="stopBuildBtn" data-testid="stop-build-button">⏹ Stop</button>`
          }
          <button class="btn btn-download" id="downloadScaffoldBtn" data-testid="download-scaffold-button" ${buildState.generatedFiles.length === 0 ? 'disabled' : ''}>
            📥 Download Scaffold
          </button>
          <button class="btn btn-open" id="openOutputFolderBtn" data-testid="open-output-folder-button">
            📂 Open Output
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
            <span class="stat" data-testid="task-progress">📋 ${buildState.currentTask || 'Waiting...'}</span>
          </div>
        </div>
        <div class="build-logs" data-testid="build-logs">
          <div class="logs-header">
            <span>📜 Build Logs</span>
            <span class="logs-count">${buildState.logs.length} entries</span>
          </div>
          <div class="logs-content">
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
    </div>
  `;
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

    // Open Output Folder button
    if (e.target.id === 'openOutputFolderBtn') {
      handleOpenOutputFolder();
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

/**
 * Handle Start Build
 */
async function handleStartBuild() {
  addLog('Initializing Agent Bridge connection...', 'info');
  updateBuildStatus('running');

  try {
    // 1. Trigger agent start via API
    const response = await fetch('http://localhost:8000/start?resume=true', { method: 'POST' });
    if (!response.ok) throw new Error('Failed to start agent API');
    
    addLog('Agent process spawned successfully', 'success');
    
    // 2. Connect to log websocket
    const socket = new WebSocket('ws://localhost:8000/ws/logs');
    
    socket.onopen = () => {
      addLog('Live log stream connected', 'info');
    };
    
    socket.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data);
        addLog(log.message, log.level || 'info');
        
        // Update task progress if possible
        if (log.message.includes('Processing task:')) {
          const taskId = log.message.split('Processing task:')[1].trim();
          updateBuildState({ currentTask: taskId });
        }
        
        if (log.message.includes('Task completed:')) {
          buildState.completedTasks += 1;
          renderBuildUI();
        }
        
        if (log.message.includes('Wrote file:')) {
          const filePath = log.message.split('Wrote file:')[1].trim();
          const fileName = filePath.split('\\').pop().split('/').pop();
          addGeneratedFile({ path: filePath, name: fileName, status: 'generated' });
        }
        
        if (log.message.includes('Agent loop finished:')) {
          updateBuildStatus('done');
          socket.close();
        }
      } catch (err) {
        console.error('Log parse error:', err);
      }
    };
    
    socket.onerror = (err) => {
      addLog('Log stream websocket error', 'error');
      updateBuildStatus('error');
    };
    
    socket.onclose = () => {
      addLog('Live log stream closed', 'info');
    };

    buildProcess = { stop: () => {
      socket.close();
      fetch('http://localhost:8000/stop', { method: 'POST' });
    }};

  } catch (error) {
    addLog(`Agent error: ${error.message}`, 'error');
    updateBuildStatus('error');
  }
}

/**
 * Handle Stop Build
 */
function handleStopBuild() {
  if (buildProcess) {
    buildProcess.stop = true;
    addLog('Stopping build process...', 'warn');
  }
  updateBuildStatus('idle');
}

/**
 * Handle Download Scaffold
 */
function handleDownloadScaffold() {
  if (buildState.generatedFiles.length === 0) {
    addLog('No files to download', 'warn');
    return;
  }

  // Create ZIP-like bundle (simplified - in production use JSZip)
  const bundle = {
    files: buildState.generatedFiles,
    timestamp: new Date().toISOString(),
    totalFiles: buildState.generatedFiles.length,
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scaffold-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  addLog(`Downloaded ${buildState.generatedFiles.length} files`, 'success');
}

/**
 * Handle Open Output Folder
 */
function handleOpenOutputFolder() {
  // In browser environment, we can't directly open folders
  // This would be handled by Tauri's shell API in the desktop app
  addLog('Opening output folder...', 'info');

  // For web, show a message or redirect to output directory listing
  const message = 'Output folder: ./output/\n\nIn the desktop app, this will open your file explorer.';
  alert(message);
  addLog('Output folder path: ./output/', 'info');
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
