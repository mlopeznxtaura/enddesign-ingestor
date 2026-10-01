/**
 * Test: Build UI Integration (Tasks 43-54)
 * Tests Start Build button, status indicator, progress display,
 * file count, Download Scaffold, and Open Output Folder.
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function testBuildUIExists() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for required exports
  const requiredExports = [
    'initBuildUI',
    'getBuildState',
    'addGeneratedFile',
    'setTotalTasks',
  ]

  for (const exp of requiredExports) {
    if (!buildUISource.includes(`export function ${exp}`) && !buildUISource.includes(`export { ${exp}`)) {
      throw new Error(`build-ui.js missing export: ${exp}`)
    }
  }

  console.log('✓ Build UI module exists with required exports')
  return true
}

export function testStartBuildButton() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for Start Build button
  if (!buildUISource.includes('startBuildBtn') && !buildUISource.includes('Start Build')) {
    throw new Error('build-ui.js missing Start Build button')
  }

  // Check for start build handler
  if (!buildUISource.includes('handleStartBuild')) {
    throw new Error('build-ui.js missing handleStartBuild function')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="start-build-button"')) {
    throw new Error('build-ui.js missing start-build-button testid')
  }

  // Check for Python agent trigger (simulateBuild or similar)
  if (!buildUISource.includes('simulateBuild') && !buildUISource.includes('build')) {
    throw new Error('build-ui.js missing build process trigger')
  }

  console.log('✓ Start Build button implemented')
  return true
}

export function testStopBuildButton() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for Stop Build button
  if (!buildUISource.includes('stopBuildBtn') && !buildUISource.includes('Stop')) {
    throw new Error('build-ui.js missing Stop Build button')
  }

  // Check for stop build handler
  if (!buildUISource.includes('handleStopBuild')) {
    throw new Error('build-ui.js missing handleStopBuild function')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="stop-build-button"')) {
    throw new Error('build-ui.js missing stop-build-button testid')
  }

  console.log('✓ Stop Build button implemented')
  return true
}

export function testBuildStatusIndicator() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for status states
  const statuses = ['idle', 'running', 'done', 'error']
  for (const status of statuses) {
    if (!buildUISource.includes(`'${status}'`) && !buildUISource.includes(`"${status}"`)) {
      throw new Error(`build-ui.js missing status state: ${status}`)
    }
  }

  // Check for status badge
  if (!buildUISource.includes('status-badge') && !buildUISource.includes('status-')) {
    throw new Error('build-ui.js missing status badge')
  }

  // Check for status update function
  if (!buildUISource.includes('updateBuildStatus')) {
    throw new Error('build-ui.js missing updateBuildStatus function')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="build-status"')) {
    throw new Error('build-ui.js missing build-status testid')
  }

  console.log('✓ Build status indicator implemented')
  return true
}

export function testProgressDisplay() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for progress elements
  const progressElements = [
    'build-progress',
    'progress-bar',
    'progress-fill',
    'progress-percent',
  ]

  for (const element of progressElements) {
    if (!buildUISource.includes(element)) {
      throw new Error(`build-ui.js missing progress element: ${element}`)
    }
  }

  // Check for task count display
  if (!buildUISource.includes('completedTasks') || !buildUISource.includes('totalTasks')) {
    throw new Error('build-ui.js missing task count display')
  }

  // Check for percentage calculation
  if (!buildUISource.includes('getProgressPercent') && !buildUISource.includes('* 100')) {
    throw new Error('build-ui.js missing percentage calculation')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="build-progress"')) {
    throw new Error('build-ui.js missing build-progress testid')
  }

  if (!buildUISource.includes('data-testid="progress-bar-fill"')) {
    throw new Error('build-ui.js missing progress-bar-fill testid')
  }

  console.log('✓ Progress display implemented')
  return true
}

export function testFileCountIndicator() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for file count display
  if (!buildUISource.includes('generatedFiles')) {
    throw new Error('build-ui.js missing generatedFiles array')
  }

  // Check for file count in stats
  if (!buildUISource.includes('file-count') && !buildUISource.includes('files')) {
    throw new Error('build-ui.js missing file count display')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="file-count"')) {
    throw new Error('build-ui.js missing file-count testid')
  }

  // Check for addGeneratedFile function
  if (!buildUISource.includes('addGeneratedFile')) {
    throw new Error('build-ui.js missing addGeneratedFile function')
  }

  console.log('✓ File count indicator implemented')
  return true
}

export function testDownloadScaffoldButton() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for Download Scaffold button
  if (!buildUISource.includes('downloadScaffoldBtn') && !buildUISource.includes('Download Scaffold')) {
    throw new Error('build-ui.js missing Download Scaffold button')
  }

  // Check for download handler
  if (!buildUISource.includes('handleDownloadScaffold')) {
    throw new Error('build-ui.js missing handleDownloadScaffold function')
  }

  // Check for data-testid
  if (!buildUISource.includes('data-testid="download-scaffold-button"')) {
    throw new Error('build-ui.js missing download-scaffold-button testid')
  }

  // Check for download functionality (Blob, URL.createObjectURL)
  if (!buildUISource.includes('Blob') || !buildUISource.includes('createObjectURL')) {
    throw new Error('build-ui.js missing download functionality')
  }

  console.log('✓ Download Scaffold button implemented')
  return true
}

export function testExportZipButton() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  if (!buildUISource.includes('exportZipBtn') && !buildUISource.includes('Export Zip')) {
    throw new Error('build-ui.js missing Export Zip button')
  }

  if (!buildUISource.includes('handleExportZip')) {
    throw new Error('build-ui.js missing handleExportZip function')
  }

  if (!buildUISource.includes('data-testid="export-zip-button"')) {
    throw new Error('build-ui.js missing export-zip-button testid')
  }

  if (!buildUISource.includes('fflate')) {
    throw new Error('build-ui.js missing fflate zip export')
  }

  console.log('✓ Export Zip button implemented')
  return true
}

export function testTaskProgressDisplay() {
  const buildUISource = readFileSync(
    join(__dirname, '../src/cli/build-ui.js'),
    'utf-8'
  )

  // Check for current task display
  if (!buildUISource.includes('currentTask')) {
    throw new Error('build-ui.js missing currentTask state')
  }

  // Check for task progress testid
  if (!buildUISource.includes('data-testid="task-progress"')) {
    throw new Error('build-ui.js missing task-progress testid')
  }

  // Check for real-time update (setInterval or similar)
  if (!buildUISource.includes('setInterval') && !buildUISource.includes('interval')) {
    throw new Error('build-ui.js missing real-time update mechanism')
  }

  console.log('✓ Task progress display implemented')
  return true
}

export function testBuildUICSS() {
  const cssSource = readFileSync(
    join(__dirname, '../src/styles/build-ui.css'),
    'utf-8'
  )

  // Check for required CSS classes
  const requiredClasses = [
    '.build-console-wrapper',
    '.build-console-header',
    '.build-console-body',
    '.status-badge',
    '.btn-start',
    '.btn-stop',
    '.btn-download',
    '.btn-open',
    '.build-progress',
    '.progress-bar',
    '.build-logs',
    '.file-tree-wrapper',
    '.code-preview-wrapper',
  ]

  for (const className of requiredClasses) {
    if (!cssSource.includes(className)) {
      throw new Error(`build-ui.css missing class: ${className}`)
    }
  }

  // Check for status state styles
  const statusStates = [
    '.status-idle',
    '.status-running',
    '.status-done',
    '.status-error',
  ]

  for (const state of statusStates) {
    if (!cssSource.includes(state)) {
      throw new Error(`build-ui.css missing status state: ${state}`)
    }
  }

  // Check for animation
  if (!cssSource.includes('@keyframes pulse')) {
    throw new Error('build-ui.css missing pulse animation')
  }

  console.log('✓ Build UI CSS has all required styles')
  return true
}

export function testMainJSIntegration() {
  const mainSource = readFileSync(
    join(__dirname, '../src/main.js'),
    'utf-8'
  )

  // Check for build-ui import
  if (!mainSource.includes('build-ui.js')) {
    throw new Error('main.js missing build-ui.js import')
  }

  // Check for initBuildUI call
  if (!mainSource.includes('initBuildUI')) {
    throw new Error('main.js missing initBuildUI call')
  }

  console.log('✓ Main.js integration complete')
  return true
}

export function testIndexHTMLIntegration() {
  const indexSource = readFileSync(
    join(__dirname, '../index.html'),
    'utf-8'
  )

  // Check for build-ui.css import
  if (!indexSource.includes('build-ui.css')) {
    throw new Error('index.html missing build-ui.css import')
  }

  console.log('✓ index.html integration complete')
  return true
}

// Run all tests
export function runBuildUITests() {
  testBuildUIExists()
  testStartBuildButton()
  testStopBuildButton()
  testBuildStatusIndicator()
  testProgressDisplay()
  testFileCountIndicator()
  testDownloadScaffoldButton()
  testExportZipButton()
  testTaskProgressDisplay()
  testBuildUICSS()
  testMainJSIntegration()
  testIndexHTMLIntegration()
  console.log('\n✅ All Build UI tests passed!')
  return true
}

// Run tests
runBuildUITests()
