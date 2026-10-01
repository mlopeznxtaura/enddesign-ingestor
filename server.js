/**
 * NextAura EndDesign Server — static UI + IBM watsonx + build agent bridge.
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  checkWatsonxHealth,
  generateNodeCode,
  generateRepairCode,
  generateStepRepairCode,
  mapStructureToDAG,
  watsonxConfig,
} from './server/ibm-watsonx.js';
import { extractFromImage } from './server/vision-extract.js';
import { extractHTMLStructure, detectDomain } from './shared/structure-extract.js';
import { structureToDAGLayers, mergeLayers } from './shared/structure-to-dag.js';
import { sanitizeGenerated, filePathForNode } from './shared/codegen-utils.js';
import { layersToTaskPlan, taskPlanToBuildNodes, dedupeNodes } from './shared/build-tasks.js';
import { verifyScaffold, computeHonestFidelity } from './shared/verify-scaffold.js';
import { consolidateParamSprawl } from './shared/consolidate-params.js';
import { runStepTests, formatStepTestLog } from './shared/verify-step.js';
import {
  MAX_STEP_REPAIR_ATTEMPTS,
  isCriticalFailure,
  applyDeterministicStepFix,
} from './shared/step-repair.js';
import { runAnatomyPipeline } from './shared/anatomy-pipeline.js';
import {
  canGenerateDeterministic,
  generateDeterministicCode,
  manifestEntryToNode,
} from './shared/deterministic-coder.js';
import { checkPythonBricklayerHealth } from './shared/python-executor.js';
import { preflightTemplateCoverage, BuildAbort } from './shared/template-registry.js';
import { bindAllViewActions } from './shared/action-binder.js';
import { computeFidelityAxes, computeIngestLayoutCoverage } from './shared/fidelity-axes.js';
import {
  defaultStlPythonExport,
  defaultCadViewportTsx,
  wireAppShellTsx,
} from './shared/stl-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '12mb' }));

const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const PROJECT = 'nextaura-core';
const LOCATION = 'us-central1';
const GEMINI_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash:generateContent`;

// ── Agent build state (same-origin bridge, no localhost:8000) ──
const agentBuild = {
  status: 'idle',
  logs: [],
  completedTasks: 0,
  totalTasks: 0,
  currentTask: null,
  files: [],
  stopRequested: false,
  running: false,
  verification: null,
  fidelity: null,
  structureFidelity: null,
  domain: 'app-ui',
  stepResults: [],
  repairState: null,
  blockedTask: null,
  allowSkipBlocked: false,
  manifest: null,
  pipeline: 'legacy',
};

function pushLog(message, level = 'info') {
  agentBuild.logs.push({
    timestamp: new Date().toISOString(),
    message,
    level,
  });
  if (agentBuild.logs.length > 500) agentBuild.logs.shift();
}

function resetAgentBuild() {
  agentBuild.status = 'idle';
  agentBuild.logs = [];
  agentBuild.completedTasks = 0;
  agentBuild.totalTasks = 0;
  agentBuild.currentTask = null;
  agentBuild.files = [];
  agentBuild.stopRequested = false;
  agentBuild.running = false;
  agentBuild.verification = null;
  agentBuild.fidelity = null;
  agentBuild.structureFidelity = null;
  agentBuild.domain = 'app-ui';
  agentBuild.stepResults = [];
  agentBuild.repairState = null;
  agentBuild.blockedTask = null;
  agentBuild.allowSkipBlocked = false;
  agentBuild.manifest = null;
  agentBuild.pipeline = 'legacy';
}

function extractTasks(layers = [], taskPlan = null) {
  if (taskPlan?.tasks?.length) {
    return dedupeNodes(taskPlanToBuildNodes(taskPlan));
  }
  const nodes = layers.flatMap((l) => l.nodes || []);
  const tasks = nodes.filter((n) => n.type !== 'root');
  return dedupeNodes(tasks.length ? tasks : nodes);
}

function buildWorkQueue(layers, taskPlan, manifest) {
  const m = manifest || taskPlan?.manifest;
  if (m?.executionOrder?.length && m.files?.length) {
    return m.executionOrder
      .map((taskId) => {
        const entry = m.files.find((f) => f.taskId === taskId);
        if (!entry) return null;
        return {
          mode: 'manifest',
          taskId,
          entry,
          node: manifestEntryToNode(entry),
        };
      })
      .filter(Boolean);
  }

  const tasks = extractTasks(layers, taskPlan).filter((n) => n.type !== 'root');
  return tasks.map((node) => ({
    mode: 'legacy',
    taskId: node.id || node.name || 'task',
    node,
    entry: null,
  }));
}

function templateCodeForNode(node, domain = 'app-ui') {
  const safeId = (node.id || 'component').replace(/[^\w]/g, '_');
  const name = node.name || safeId;
  const params = (node.params || [])
    .map((p) => `  // ${p.label}: ${p.value}`)
    .join('\n');

  if (node.type === 'ui') {
    return `import React, { useState } from 'react';

/** UI panel: ${name} */
export function ${toPascal(safeId)}() {
  const [values, setValues] = useState({});
${params ? `\n${params}\n` : ''}
  return (
    <section data-node="${safeId}" className="${safeId}-panel">
      <h2>${name}</h2>
      <p>${node.desc || ''}</p>
    </section>
  );
}
`;
  }

  if (node.type === 'io') {
    return `/**
 * I/O artifact: ${name}
 */
export const ${toCamel(safeId)}Meta = {
  id: '${safeId}',
  name: '${name}',
  domain: '${domain}',
  snippet: ${JSON.stringify((node.snippet || '').slice(0, 500))},
};
`;
  }

  return `/**
 * Handler: ${name}
 */
export async function ${toCamel(safeId)}(input: Record<string, unknown> = {}) {
${params ? `${params}\n` : ''}
  return { ok: true, node: '${safeId}', name: '${name}', input };
}
`;
}

function toPascal(s) {
  return s.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/_/g, '');
}

function toCamel(s) {
  const p = toPascal(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function logStepTestResults(taskId, path, result, phase = 'step') {
  pushLog(`${phase}: testing ${taskId} → ${path}`, 'info');
  for (const line of formatStepTestLog(result)) {
    pushLog(line.message, line.level);
  }
  const summary = result.ok
    ? `${phase}: PASSED ${taskId} (${result.passed}/${result.tests.length} checks)`
    : `${phase}: FAILED ${taskId} (${result.failed}/${result.tests.length} checks failed)`;
  pushLog(summary, result.ok ? 'success' : 'error');
}

async function runStepGateWithRepair(file, node, taskId, domain, target, wx) {
  let result = runStepTests(file, {
    domain,
    node,
    taskId,
    manifestActions: agentBuild.manifest?.actions || [],
  });
  logStepTestResults(taskId, file.path, result, 'step');
  let attempts = 0;

  while (!result.ok && isCriticalFailure(result) && attempts < MAX_STEP_REPAIR_ATTEMPTS) {
    const failedIssues = result.issues;
    agentBuild.repairState = {
      taskId,
      path: file.path,
      attempt: attempts + 1,
      maxAttempts: MAX_STEP_REPAIR_ATTEMPTS,
      issues: failedIssues.map((i) => ({ id: i.id, message: i.message })),
    };

    const failedIds = failedIssues.map((i) => i.id).join(', ');
    pushLog(`PAUSE [${taskId}]: ${failedIds}`, 'warn');

    let repaired = applyDeterministicStepFix(file, failedIssues, node, domain);

    if (!repaired && file.deterministic && file.manifestEntry) {
      const regen = await generateDeterministicCode(file.manifestEntry, {
        domain,
        manifestActions: agentBuild.manifest?.actions,
        manifestViews: agentBuild.manifest?.views,
        onPythonFallback: (_entry, err) => {
          pushLog(`Python bricklayer fallback: ${err.message}`, 'warn');
        },
      });
      if (regen?.code) {
        file.content = regen.code;
        repaired = true;
        pushLog(
          `Step repair: deterministic regen ${file.path} (${regen.source})`,
          'warn',
        );
      }
    }

    if (!repaired && wx?.ok && !file.deterministic) {
      try {
        const fixed = await generateStepRepairCode(failedIssues, file, node, { domain, target });
        const pseudoNode = node || { id: taskId, type: file.nodeType || 'ui', name: file.name };
        const sanitized = sanitizeGenerated(fixed, pseudoNode, domain);
        file.content = sanitized.content;
        repaired = true;
        pushLog(
          `Step repair: LLM fix for ${file.path} (attempt ${attempts + 1}/${MAX_STEP_REPAIR_ATTEMPTS})`,
          'success',
        );
      } catch (e) {
        pushLog(`Step repair: LLM failed ${file.path}: ${e.message}`, 'warn');
      }
    } else if (repaired) {
      pushLog(`Step repair: deterministic fix for ${file.path}`, 'warn');
    }

    if (repaired) {
      pushLog(`Wrote file: ${file.path}`, 'success');
    }

    attempts += 1;
    const phase = attempts === 1 ? 'retest' : `retest-${attempts}`;
    result = runStepTests(file, { domain, node, taskId });
    logStepTestResults(taskId, file.path, result, phase);
  }

  agentBuild.repairState = null;

  if (result.ok) {
    file.status = 'verified';
  } else if (isCriticalFailure(result)) {
    file.status = 'blocked';
  } else {
    file.status = 'failed';
  }

  const stepRecord = {
    taskId,
    path: file.path,
    ok: result.ok,
    passed: result.passed,
    failed: result.failed,
    tests: result.tests,
    attempts,
    timestamp: new Date().toISOString(),
  };
  agentBuild.stepResults.push(stepRecord);

  return {
    ok: result.ok,
    criticalBlocked: !result.ok && isCriticalFailure(result),
    stepRecord,
  };
}

async function runAgentBuild(layers, target = 'react', taskPlan = null, domain = 'app-ui') {
  const manifest = taskPlan?.manifest || agentBuild.manifest;
  const workQueue = buildWorkQueue(layers, taskPlan, manifest);

  if (!workQueue.length) {
    pushLog('No tasks in DAG — ingest a design first', 'warn');
    agentBuild.status = 'error';
    agentBuild.running = false;
    return;
  }

  if (manifest?.executionOrder?.length) {
    agentBuild.manifest = manifest;
    agentBuild.pipeline = manifest.pipeline || 'anatomy-first';
  }

  if (manifest?.views?.length) {
    try {
      preflightTemplateCoverage(manifest, { strictMode: true });
    } catch (e) {
      if (e instanceof BuildAbort) {
        pushLog(`PREFLIGHT ABORT: ${e.message}`, 'error');
        agentBuild.status = 'error';
        agentBuild.running = false;
        return;
      }
      throw e;
    }
  }

  agentBuild.totalTasks = workQueue.length;
  agentBuild.completedTasks = 0;
  agentBuild.files = [];
  agentBuild.running = true;
  agentBuild.status = 'running';
  agentBuild.stopRequested = false;

  pushLog(
    `Build started — ${workQueue.length} tasks (domain: ${domain}, pipeline: ${agentBuild.pipeline})`,
    'info',
  );

  const wx = await checkWatsonxHealth();
  if (wx.ok) {
    pushLog(`IBM watsonx ready: ${wx.model}`, 'success');
  } else if (wx.configured) {
    pushLog(`IBM watsonx unavailable — deterministic/template codegen`, 'warn');
  } else {
    pushLog('Deterministic codegen only', 'warn');
  }

  const ctx = { domain, target };

  for (const item of workQueue) {
    if (agentBuild.stopRequested) {
      pushLog('Build stopped by user', 'warn');
      agentBuild.status = 'idle';
      agentBuild.running = false;
      return;
    }

    const { node, taskId, entry, mode } = item;
    agentBuild.currentTask = taskId;
    pushLog(`Processing task: ${taskId}`, 'info');

    let content;
    let relPath;

    if (mode === 'manifest' && entry && canGenerateDeterministic(entry)) {
      const generated = await generateDeterministicCode(entry, {
        domain,
        viewTypes: entry.viewTypes,
        manifestViews: manifest?.views,
        manifestActions: manifest?.actions,
        onPythonFallback: (_e, err) => {
          pushLog(`Python bricklayer fallback for ${taskId}: ${err.message}`, 'warn');
        },
      });
      content = generated?.code;
      relPath = entry.path;
      const brick = generated?.source === 'python' ? 'Python bricklayer' : 'JS template';
      pushLog(`Deterministic codegen (${brick}): ${relPath}`, 'success');
    } else {
      content = templateCodeForNode(node, domain);

      if (wx.ok && !entry?.deterministic) {
        try {
          const generated = await generateNodeCode(node, target, ctx);
          if (generated && generated.length > 40) {
            const sanitized = sanitizeGenerated(generated, node, domain);
            content = sanitized.content;
            if (!sanitized.validation.ok) {
              pushLog(`Syntax warn ${taskId}: ${sanitized.validation.issues.join(', ')}`, 'warn');
            }
            pushLog(`IBM model generated code for ${taskId}`, 'success');
          }
        } catch (e) {
          pushLog(`IBM codegen fallback for ${taskId}: ${e.message}`, 'warn');
        }
      }

      const sanitized = sanitizeGenerated(content, node, domain);
      content = sanitized.content;
      relPath = entry?.path || filePathForNode(node, sanitized.content, domain);
    }

    const fileName = relPath.split('/').pop();

    if (agentBuild.files.some((f) => f.path === relPath)) {
      pushLog(`Skip duplicate path: ${relPath}`, 'warn');
      agentBuild.completedTasks += 1;
      continue;
    }

    const fileEntry = {
      path: relPath,
      name: fileName,
      content,
      status: 'generated',
      taskId,
      nodeType: node.type,
      deterministic: entry?.deterministic ?? false,
      manifestEntry: entry || null,
    };
    agentBuild.files.push(fileEntry);
    pushLog(`Wrote file: ${relPath}`, 'success');

    const gate = await runStepGateWithRepair(fileEntry, node, taskId, domain, target, wx);

    if (gate.criticalBlocked) {
      agentBuild.blockedTask = taskId;
      if (!agentBuild.allowSkipBlocked) {
        agentBuild.status = 'blocked';
        agentBuild.running = false;
        pushLog(`BUILD HALTED at ${taskId} — fix or enable skip blocked tasks`, 'error');
        return;
      }
      pushLog(`SKIP blocked task ${taskId}`, 'warn');
      agentBuild.completedTasks += 1;
      continue;
    }

    agentBuild.completedTasks += 1;
    if (gate.ok) {
      pushLog(`Task completed: ${taskId}`, 'success');
    } else {
      pushLog(`Task completed with warnings: ${taskId}`, 'warn');
    }
  }

  if (manifest?.views?.length) {
    const bound = bindAllViewActions(agentBuild.files, manifest);
    if (bound.length) {
      pushLog(`Binding pass wired handlers: ${bound.join(', ')}`, 'success');
      for (const viewId of bound) {
        const file = agentBuild.files.find((f) => f.taskId === viewId);
        if (file) {
          const gate = await runStepGateWithRepair(
            file,
            manifestEntryToNode(file.manifestEntry || { taskId: viewId }),
            viewId,
            domain,
            target,
            wx,
          );
          if (gate.criticalBlocked && !agentBuild.allowSkipBlocked) {
            agentBuild.status = 'blocked';
            agentBuild.running = false;
            pushLog(`BUILD HALTED after binding at ${viewId}`, 'error');
            return;
          }
        }
      }
    }
  }

  // App shell — skip if anatomy-first manifest already generated AppShell
  const hasManifestShell = agentBuild.files.some(
    (f) => f.path === 'src/AppShell.tsx' && f.taskId === 'app_shell',
  );

  if (!hasManifestShell) {
    const root = layers.flatMap((l) => l.nodes || []).find((n) => n.type === 'root');
    const panelPaths = agentBuild.files
      .filter(
        (f) =>
          (f.path?.startsWith('src/components/') || f.path?.startsWith('src/views/')) &&
          /\.tsx$/i.test(f.path),
      )
      .map((f) => f.path)
      .slice(0, 8);
    const shellContent = wireAppShellTsx(root?.name || 'App', domain, panelPaths);
    const shellIdx = agentBuild.files.findIndex((f) => f.path === 'src/AppShell.tsx');
    const shellEntry = {
      path: 'src/AppShell.tsx',
      name: 'AppShell.tsx',
      content: shellContent,
      status: 'generated',
      taskId: 'app_shell_legacy',
    };
    if (shellIdx >= 0) agentBuild.files[shellIdx] = shellEntry;
    else agentBuild.files.push(shellEntry);
    pushLog('Wrote file: src/AppShell.tsx (wired layout)', 'success');
    const shellGate = await runStepGateWithRepair(
      shellEntry,
      root || { type: 'root', id: 'app_shell' },
      'app_shell',
      domain,
      target,
      wx,
    );

    if (shellGate.criticalBlocked && shellEntry.status === 'blocked') {
      agentBuild.blockedTask = 'app_shell';
      if (!agentBuild.allowSkipBlocked) {
        agentBuild.status = 'blocked';
        agentBuild.running = false;
        pushLog('BUILD HALTED at app_shell — fix or enable skip blocked tasks', 'error');
        return;
      }
      pushLog('SKIP blocked app_shell', 'warn');
    }
  } else {
    pushLog('AppShell from manifest — skip legacy wire', 'info');
  }

  await runPostBuildVerifyAndFix(domain, target, layers);

  if (agentBuild.status === 'blocked') {
    agentBuild.running = false;
    return;
  }

  agentBuild.completedTasks = agentBuild.files.length;
  agentBuild.status = 'done';
  agentBuild.running = false;
  pushLog(`Agent loop finished: ${agentBuild.files.length} files`, 'success');
}

async function runPostBuildVerifyAndFix(domain, target, layers) {
  pushLog('Verify: smoke test + post-process…', 'info');

  agentBuild.files = consolidateParamSprawl(agentBuild.files);
  pushLog('Verify: consolidated parameter sprawl where detected', 'info');

  for (const file of agentBuild.files) {
    if (file.path?.endsWith('.py') && /import\s+React|from\s+['"]react['"]/.test(file.content || '')) {
      if (file.path.includes('stl_export')) {
        file.content = defaultStlPythonExport();
        pushLog('Verify: stl_export.py → build123d Python template', 'warn');
      } else {
        const newPath = file.path.replace(/\.py$/, '.tsx');
        file.path = newPath;
        file.name = newPath.split('/').pop();
        pushLog(`Verify: renamed ${file.path} (.py had React)`, 'warn');
      }
    }
  }

  let verification = verifyScaffold(agentBuild.files, domain);
  const wx = await checkWatsonxHealth();
  const repairQueue = verification.issues.filter(
    (i) =>
      i.path &&
      ['DUPLICATE_EXPORT', 'WRONG_LIBRARY', 'EMPTY_SHELL', 'MISSING_3D_STACK', 'EXT_MISMATCH'].includes(
        i.code,
      ),
  );

  if (wx.ok && repairQueue.length) {
    for (const issue of repairQueue.slice(0, 4)) {
      const file = agentBuild.files.find((f) => f.path === issue.path);
      if (!file) continue;
      const lateLabel = issue.code === 'EXT_MISMATCH' ? 'late repair — should have been caught at step' : '';
      pushLog(
        `Verify: LLM repair ${issue.path} (${issue.code})${lateLabel ? ` — ${lateLabel}` : ''}`,
        'info',
      );
      try {
        if (issue.repair === 'regenerate_viewport_r3f') {
          file.content = defaultCadViewportTsx('Real-time 3D Viewport');
          pushLog(`Verify: applied react-three-fiber viewport template`, 'success');
          continue;
        }
        const fixed = await generateRepairCode(issue, file, { domain, target });
        const pseudoNode = { id: file.path, type: 'ui', name: file.name };
        const sanitized = sanitizeGenerated(fixed, pseudoNode, domain);
        file.content = sanitized.content;
        if (issue.code === 'DUPLICATE_EXPORT') {
          const lines = sanitized.content.split('\n');
          const seen = new Set();
          file.content = lines
            .filter((line) => {
              const m = line.match(/export\s+(?:const|function|class)\s+(\w+)/);
              if (!m) return true;
              if (seen.has(m[1])) return false;
              seen.add(m[1]);
              return true;
            })
            .join('\n');
        }
        pushLog(`Verify: repaired ${file.path}`, 'success');
      } catch (e) {
        pushLog(`Verify: repair failed ${issue.path}: ${e.message}`, 'warn');
      }
    }
    verification = verifyScaffold(agentBuild.files, domain);
  }

  agentBuild.verification = verification;
  agentBuild.fidelity = computeHonestFidelity(
    agentBuild.structureFidelity,
    verification,
    agentBuild.files,
    agentBuild.manifest,
  );

  const label = verification.ok ? 'success' : 'warn';
  const ax = agentBuild.fidelity.axes;
  const axisLine = ax
    ? `structure ${ax.structure?.score}% · wiring ${ax.wiring?.score ?? '—'}% · fields ${ax.fields?.score ?? '—'}%`
    : '';
  pushLog(
    `Verify: compile ${verification.compileScore}% | honest ${agentBuild.fidelity.score}% ${axisLine} (${verification.counts.total} issues)`,
    label,
  );
  for (const issue of verification.issues.slice(0, 5)) {
    pushLog(`  [${issue.code}] ${issue.message}`, issue.severity === 'critical' ? 'error' : 'warn');
  }
}

// ── Health ──
app.get('/health', async (_req, res) => {
  const watsonx = await checkWatsonxHealth();
  const pythonBricklayer = await checkPythonBricklayerHealth();
  res.json({
    status: 'ok',
    app: 'enddesign-ingestor',
    watsonx,
    pythonBricklayer,
    agent: { status: agentBuild.status, tasks: agentBuild.totalTasks },
  });
});

// ── IBM watsonx ──
app.get('/api/ibm/status', async (_req, res) => {
  res.json(await checkWatsonxHealth());
});

app.post('/api/pipeline/ingest', async (req, res) => {
  const { text, type = 'ui', useIbm = true, image, imageMime } = req.body || {};

  try {
    let structure;
    let structureSource = 'html';

    if (image) {
      const vision = await extractFromImage(image, imageMime || 'image/png');
      structure = vision.structure;
      structureSource = vision.source;
    } else if (text?.trim()) {
      if (text.trim().startsWith('[Image:')) {
        return res.status(400).json({
          error: 'Image placeholder in text box — drop the image file again, then Ingest & Map',
        });
      }
      if (isHtmlDesignText(text)) {
        structure = extractHTMLStructure(text);
        structureSource = 'html-structure';
      } else {
        structure = freeformToStructure(text);
        structureSource = 'freeform';
      }
    } else {
      return res.status(400).json({ error: 'text or image required' });
    }

    let layers;
    let taskPlan;
    let manifest = null;
    let anatomy = null;
    let pipelineStats = null;
    let pipeline = 'legacy';

    if (
      structureSource !== 'freeform' &&
      (structure.parts?.length ||
        structure.columns?.length ||
        structure.actions?.length ||
        structure.views?.length)
    ) {
      const anatomyResult = runAnatomyPipeline(structure);
      layers = anatomyResult.layers;
      taskPlan = anatomyResult.taskPlan;
      manifest = anatomyResult.manifest;
      anatomy = anatomyResult.anatomy;
      pipelineStats = anatomyResult.stats;
      pipeline = anatomyResult.pipeline;
    } else {
      layers = structureToDAGLayers(structure);

      if (useIbm && (structure.columns.length || structure.parts.length || image)) {
        try {
          const ibmLayers = await mapStructureToDAG(structure, type);
          layers = mergeLayers(layers, ibmLayers);
        } catch (e) {
          console.warn('IBM DAG enrich failed:', e.message);
        }
      }

      taskPlan = layersToTaskPlan(layers, structure.domain);
    }
    const fidelity = computeIngestFidelity(structure, layers, manifest);
    const warnings = [];
    if (structureSource === 'freeform') {
      warnings.push(
        'Text parsed as outline (not HTML). Drop .html file or paste full HTML source — not visible UI text.',
      );
    }
    if (structureSource === 'html-structure' && !structure.parts?.length && !structure.params?.length) {
      warnings.push('HTML detected but no parameter-group/input-row found — structure may be incomplete.');
    }
    const lineNodes = layers.flatMap((l) => l.nodes || []).filter((n) => /^line_\d+$/.test(n.id || ''));
    if (lineNodes.length) {
      warnings.push(`Found ${lineNodes.length} line_* nodes — likely freeform fallback, not rich HTML parse.`);
    }

    res.json({
      layers,
      taskPlan,
      manifest,
      anatomy,
      pipeline,
      pipelineStats,
      structure,
      source: structureSource,
      warnings,
      model: useIbm ? watsonxConfig().model : 'local',
      domain: structure.domain,
      fidelity,
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

function isHtmlDesignText(text = '') {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('<')) return true;
  if (/<!doctype\s+html/i.test(t)) return true;
  if (/<html[\s>]/i.test(t)) return true;
  if (/class=["'][^"']*parameter-group/i.test(t)) return true;
  if (/class=["'][^"']*panel-title/i.test(t)) return true;
  if (/data-key=["']/i.test(t)) return true;
  if (/class=["'][^"']*input-row/i.test(t)) return true;
  if (/class=["'][^"']*code-area/i.test(t)) return true;
  return false;
}

function freeformToStructure(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0]?.slice(0, 80) || 'App';
  const columns = lines.slice(0, 8).map((line, i) => ({
    id: `line_${i}`,
    name: line.slice(0, 60),
    type: 'panel',
    source: 'freeform',
  }));
  return {
    appTitle: title,
    domain: detectDomain(text, { columns }),
    columns,
    parts: [],
    params: [],
    actions: [],
    materials: [],
    codeSnippet: '',
    confidence: 0.45,
  };
}

function computeIngestFidelity(structure, layers, manifest) {
  const layoutCoverage = computeIngestLayoutCoverage(structure, manifest);
  const legacy = computeFidelityLegacy(structure, layers);

  if (manifest?.views?.length) {
    const score =
      layoutCoverage.total > 0 ? layoutCoverage.score : 0;
    return {
      score,
      structureScore: score,
      hits: layoutCoverage.hits,
      total: layoutCoverage.total,
      layoutCoverage,
      legacy,
      kind: 'ingest-anatomy',
      refuseScore: layoutCoverage.total === 0,
    };
  }

  const score = legacy.total > 0 ? legacy.score : layoutCoverage.total > 0 ? layoutCoverage.score : 0;
  return {
    score,
    structureScore: score,
    hits: legacy.total > 0 ? legacy.hits : layoutCoverage.hits,
    total: legacy.total > 0 ? legacy.total : layoutCoverage.total,
    layoutCoverage,
    legacy,
    kind: 'ingest',
    refuseScore: layoutCoverage.total === 0 && legacy.total === 0,
  };
}

function computeFidelityLegacy(structure, layers) {
  const all = layers.flatMap((l) => l.nodes || []);
  const names = new Set(all.map((n) => n.name?.toLowerCase()));
  let hits = 0;
  let total = 0;
  for (const p of structure.parts || []) {
    total += 1;
    if (names.has(p.name?.toLowerCase()) || all.find((n) => n.id === p.id)) hits += 1;
  }
  for (const c of structure.columns || []) {
    total += 1;
    if (all.find((n) => n.id === c.id)) hits += 1;
  }
  const score = total ? Math.round((hits / total) * 100) : 0;
  return { score, structureScore: score, hits, total, nodes: all.length, kind: 'legacy-parts' };
}

app.post('/api/ingest/map', async (req, res) => {
  const { text, type = 'ui', useIbm = true } = req.body || {};
  if (!text?.trim()) {
    return res.status(400).json({ error: 'text required' });
  }

  try {
    const structure = text.trim().startsWith('<') ? extractHTMLStructure(text) : null;
    let layers = structure ? structureToDAGLayers(structure) : [];

    if (useIbm && structure) {
      try {
        const ibmLayers = await mapStructureToDAG(structure, type);
        layers = mergeLayers(layers, ibmLayers);
      } catch (e) {
        if (!layers.length) throw e;
      }
    }

    if (!layers.length) {
      return res.status(502).json({ error: 'Could not map design', source: 'pipeline' });
    }

    res.json({
      layers,
      source: useIbm ? 'ibm' : 'local',
      model: watsonxConfig().model,
      domain: structure?.domain,
      taskPlan: layersToTaskPlan(layers, structure?.domain || 'app-ui'),
    });
  } catch (e) {
    res.status(502).json({ error: e.message, source: 'ibm' });
  }
});

// ── Agent bridge (production paths) ──
app.post('/api/agent/start', async (req, res) => {
  if (agentBuild.running) {
    return res.status(409).json({ error: 'Build already running' });
  }

  const { layers, target = 'react', resume, taskPlan, domain, fidelity, allowSkipBlocked } = req.body || {};
  if (!resume) resetAgentBuild();

  agentBuild.domain = domain || 'app-ui';
  agentBuild.structureFidelity = fidelity || null;
  if (taskPlan?.manifest) {
    agentBuild.manifest = taskPlan.manifest;
    agentBuild.pipeline = taskPlan.manifest.pipeline || 'anatomy-first';
  }
  if (allowSkipBlocked !== undefined) {
    agentBuild.allowSkipBlocked = Boolean(allowSkipBlocked);
  }

  pushLog('Agent Bridge connected (same-origin)', 'success');
  runAgentBuild(layers || [], target, taskPlan, domain || 'app-ui').catch((e) => {
    pushLog(`Agent crash: ${e.message}`, 'error');
    agentBuild.status = 'error';
    agentBuild.running = false;
  });

  res.json({ success: true, status: 'running' });
});

app.post('/api/agent/stop', (_req, res) => {
  agentBuild.stopRequested = true;
  pushLog('Stop requested', 'warn');
  res.json({ success: true, status: agentBuild.status });
});

app.post('/api/agent/config', (req, res) => {
  const { allowSkipBlocked } = req.body || {};
  if (allowSkipBlocked !== undefined) {
    agentBuild.allowSkipBlocked = Boolean(allowSkipBlocked);
    pushLog(`Config: allowSkipBlocked=${agentBuild.allowSkipBlocked}`, 'info');
  }
  res.json({
    success: true,
    allowSkipBlocked: agentBuild.allowSkipBlocked,
  });
});

app.get('/api/agent/status', (_req, res) => {
  res.json({
    status: agentBuild.status,
    logs: agentBuild.logs,
    completedTasks: agentBuild.completedTasks,
    totalTasks: agentBuild.totalTasks,
    currentTask: agentBuild.currentTask,
    files: agentBuild.files,
    generatedFiles: agentBuild.files,
    verification: agentBuild.verification,
    fidelity: agentBuild.fidelity,
    stepResults: agentBuild.stepResults,
    repairState: agentBuild.repairState,
    blockedTask: agentBuild.blockedTask,
    allowSkipBlocked: agentBuild.allowSkipBlocked,
    manifest: agentBuild.manifest,
    pipeline: agentBuild.pipeline,
    stepSummary: {
      total: agentBuild.stepResults.length,
      passed: agentBuild.stepResults.filter((s) => s.ok).length,
      failed: agentBuild.stepResults.filter((s) => !s.ok).length,
    },
  });
});

// Legacy aliases (build-ui previously hit localhost:8000)
app.post('/start', async (req, res) => {
  if (agentBuild.running) return res.status(409).json({ error: 'Build already running' });
  const { layers, target = 'react', taskPlan, domain } = req.body || {};
  resetAgentBuild();
  pushLog('Agent Bridge connected (legacy /start)', 'success');
  runAgentBuild(layers || [], target, taskPlan, domain || 'app-ui').catch((e) => {
    pushLog(`Agent crash: ${e.message}`, 'error');
    agentBuild.status = 'error';
    agentBuild.running = false;
  });
  res.json({ success: true, status: 'running' });
});
app.post('/stop', (_req, res) => {
  agentBuild.stopRequested = true;
  res.json({ success: true });
});
app.get('/status', (_req, res) => {
  res.json({
    status: agentBuild.status,
    logs: agentBuild.logs,
    completedTasks: agentBuild.completedTasks,
    totalTasks: agentBuild.totalTasks,
    files: agentBuild.files,
  });
});

// ── Gemini proxy (optional) ──
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, image, temperature = 0.7 } = req.body;
    const parts = [{ text: prompt }];
    if (image) {
      parts.push({ inlineData: { mimeType: 'image/png', data: image } });
    }

    const token = await getGcpAccessToken();
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature, maxOutputTokens: 4096, topP: 0.95 },
      }),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    res.json({ text, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Static + SPA ──
app.use('/data', express.static(join(__dirname, 'data')));
app.use(express.static(join(__dirname, 'dist')));
app.use((_req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

async function getGcpAccessToken() {
  if (GEMINI_KEY) return GEMINI_KEY;
  try {
    const { execSync } = await import('child_process');
    return execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

app.listen(PORT, () => {
  const cfg = watsonxConfig();
  console.log(`EndDesign Ingestor on :${PORT}`);
  console.log(`IBM watsonx: ${cfg.model} space=${cfg.spaceId} key=${cfg.hasApiKey}`);
  console.log(`Agent API: /api/agent/start /api/agent/status`);
});
