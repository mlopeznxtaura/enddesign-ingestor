/**
 * IBM watsonx.ai text generation client.
 * Uses deployment space (WML-linked) — project association not required.
 */
import { buildStepRepairPrompt } from '../shared/step-repair.js';
const IAM_URL = 'https://iam.cloud.ibm.com/identity/token';
const DEFAULT_URL = 'https://us-south.ml.cloud.ibm.com';
const DEFAULT_MODEL = 'mistralai/mistral-small-3-1-24b-instruct-2503';
const DEFAULT_SPACE = '67c9c11d-79e1-4acb-b2cc-41c8ee2b4af4';
const DEFAULT_PROJECT = '5e42bed4-6dff-4a01-a9b4-184a794f1dfd';

let cachedToken = null;
let tokenExpiresAt = 0;

function getApiKey() {
  return process.env.WATSONX_API_KEY || process.env.IBM_CLOUD_API_KEY || '';
}

export function watsonxConfig() {
  return {
    url: process.env.WATSONX_URL || DEFAULT_URL,
    model: process.env.WATSONX_MODEL || DEFAULT_MODEL,
    spaceId: process.env.WATSONX_SPACE_ID || DEFAULT_SPACE,
    projectId: process.env.WATSONX_PROJECT_ID || DEFAULT_PROJECT,
    hasApiKey: Boolean(getApiKey()),
  };
}

export async function getIamToken() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Set IBM_CLOUD_API_KEY or WATSONX_API_KEY for watsonx');
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const res = await fetch(IAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.errorMessage || data.errorCode || 'IAM token request failed');
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

function buildContextPayload(cfg) {
  if (cfg.spaceId) return { space_id: cfg.spaceId };
  if (cfg.projectId) return { project_id: cfg.projectId };
  throw new Error('Set WATSONX_SPACE_ID or WATSONX_PROJECT_ID');
}

export async function generateText(prompt, options = {}) {
  const cfg = watsonxConfig();
  const token = await getIamToken();
  const maxTokens = options.maxTokens ?? 2048;
  const temperature = options.temperature ?? 0.2;

  const body = {
    input: prompt,
    model_id: cfg.model,
    ...buildContextPayload(cfg),
    parameters: {
      max_new_tokens: maxTokens,
      temperature,
      top_p: 0.95,
      repetition_penalty: 1.05,
    },
  };

  const res = await fetch(`${cfg.url}/ml/v1/text/generation?version=2024-05-31`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 90000),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors?.[0]?.message || data.error || res.statusText;
    throw new Error(msg);
  }

  return data.results?.[0]?.generated_text?.trim() || '';
}

export async function checkWatsonxHealth() {
  const cfg = watsonxConfig();
  if (!cfg.hasApiKey) {
    return {
      ok: false,
      configured: false,
      model: cfg.model,
      spaceId: cfg.spaceId,
      hint: 'Set IBM_CLOUD_API_KEY on Code Engine app',
    };
  }

  try {
    const text = await generateText('Reply with exactly the word OK and nothing else.', { maxTokens: 12, temperature: 0 });
    const ok = /\bOK\b/i.test(text);
    return {
      ok,
      configured: true,
      model: cfg.model,
      spaceId: cfg.spaceId,
      sample: text.slice(0, 60),
    };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      model: cfg.model,
      spaceId: cfg.spaceId,
      error: e.message,
    };
  }
}

/**
 * Ask watsonx to enrich structure → function DAG layers JSON.
 */
export async function mapStructureToDAG(structure, type = 'ui') {
  const structureJson = JSON.stringify(structure).slice(0, 6000);
  const prompt = `You are EndDesign Architect. Given this EXTRACTED UI structure, output a backwards function DAG.

Do NOT invent elements not in the structure. Wire edges: UI → fn → io → root.

Output ONLY raw JSON:
{"layers":[{"label":"UI / Layout","nodes":[{"id":"slug","name":"Name","type":"ui|fn|io|root","desc":"...","layer":"ui","edges":["other-id"],"params":[]}]}]}

Design type: ${type}
Domain: ${structure.domain || 'app-ui'}
App: ${structure.appTitle || 'App'}

Extracted structure:
${structureJson}`;

  const raw = await generateText(prompt, { maxTokens: 2500, temperature: 0.1 });
  const candidates = [raw, raw.replace(/```json\s*/gi, '').replace(/```/g, '')];
  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.layers?.length) return parsed.layers;
    } catch {
      // continue
    }
  }
  throw new Error('Model did not return valid DAG JSON');
}

/**
 * Legacy: map raw text (no structure) — prefer mapStructureToDAG.
 */
export async function mapDesignToDAG(text, type = 'ui') {
  const prompt = `Map this ${type} design to a function DAG. Output ONLY raw JSON, no markdown, no explanation.

Schema:
{"layers":[{"label":"UI Layer","nodes":[{"id":"slug","name":"Name","type":"ui","desc":"desc","layer":"ui","edges":["id"]}]}]}

Types: ui, fn, io, root. Include 3-8 nodes across layers.

Design:
${text.slice(0, 8000)}`;

  const raw = await generateText(prompt, { maxTokens: 2000, temperature: 0.1 });
  const candidates = [
    raw,
    raw.replace(/```json\s*/gi, '').replace(/```/g, ''),
  ];
  for (const candidate of candidates) {
    const jsonMatch = candidate.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.layers && Array.isArray(parsed.layers) && parsed.layers.length) {
        return parsed.layers;
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error('Model did not return valid JSON layers');
}

/**
 * Generate scaffold code for a DAG node via watsonx.
 */
export async function generateNodeCode(node, target = 'react', context = {}) {
  const domain = context.domain || 'app-ui';
  const paramsBlock = (node.params || [])
    .map((p) => `- ${p.label}: ${p.value}`)
    .join('\n');

  let domainRules = '';
  if (domain === 'cad-stl') {
    domainRules = `
- CAD domain: 3D viewport must use @react-three/fiber + drei, NOT @deck.gl or mapbox.
- STL I/O nodes (type io, stl): output Python using build123d (from build123d import *). No React in .py files.
- Code editor panels: use @monaco-editor/react if needed.
- Param logic: prefer typed config objects, not one file per scalar.`;
  }

  let languageRules = '';
  if (node.type === 'ui' || node.type === 'fn') {
    languageRules =
      '- Output language: TypeScript/React ONLY. Never Python syntax — no dict literals like {"key": val}, no def keyword, no Python imports.';
  } else if (node.type === 'io') {
    languageRules =
      '- Output language: Python/build123d ONLY. Never React, JSX, or TypeScript.';
  }

  const prompt = `Generate production-ready ${target} code for this DAG node.

Node id: ${node.id}
Name: ${node.name}
Type: ${node.type}
Description: ${node.desc || ''}
Domain: ${domain}
Parameters:
${paramsBlock || 'none'}

Rules:
- Return ONLY raw source code. No markdown fences. No explanation.
- ONE export per file (no duplicate export names).
- ui nodes: TypeScript React (.tsx) with real layout and state hooks.
- fn nodes: TypeScript (.ts) handlers or config objects.
- io + stl: Python (.py) with build123d for CAD export — never React/JSX in Python.
${languageRules}
${domainRules}`;

  return generateText(prompt, { maxTokens: 1800, temperature: 0.2 });
}

/**
 * Regenerate a file after verification failure.
 */
export async function generateRepairCode(issue, file, context = {}) {
  const domain = context.domain || 'app-ui';
  let instruction = '';

  switch (issue.repair) {
    case 'fix_stl_io':
      instruction = `Rewrite as Python using build123d. Export STL from parametric wheel. No React/JSX. File must be valid .py`;
      break;
    case 'regenerate_viewport_r3f':
      instruction = `Use @react-three/fiber Canvas + @react-three/drei OrbitControls for a CAD wheel preview. Do NOT use @deck.gl or mapbox.`;
      break;
    case 'regenerate_ui':
      instruction = `Full React component with layout, labels, inputs or Monaco editor — not an empty div shell.`;
      break;
    case 'regenerate_file':
      if (issue.code === 'EXT_MISMATCH' && /\.tsx?$/.test(file.path || '')) {
        instruction =
          'FATAL ERROR: You wrote Python syntax into a TypeScript file. Rewrite using only valid TypeScript/React. Do NOT use Python dicts, def, or import from non-TS modules.';
      } else {
        instruction = `Fix: ${issue.message}. Single export only. Compile-ready TypeScript.`;
      }
      break;
    default:
      if (issue.code === 'EXT_MISMATCH' && /\.tsx?$/.test(file.path || '')) {
        instruction =
          'FATAL ERROR: You wrote Python syntax into a TypeScript file. Rewrite using only valid TypeScript/React.';
      } else {
        instruction = issue.message;
      }
  }

  const prompt = `Repair this generated file for domain ${domain}.

Path: ${file.path}
Problem: ${issue.message}
Instruction: ${instruction}

Current broken content:
${(file.content || '').slice(0, 2000)}

Return ONLY the fixed full file source. No markdown.`;

  return generateText(prompt, { maxTokens: 2000, temperature: 0.15 });
}

/**
 * Step-loop repair — isolated file context with compiler-style errors.
 */
export async function generateStepRepairCode(failedTests, file, node, context = {}) {
  const domain = context.domain || 'app-ui';
  const { instructions, language } = buildStepRepairPrompt(
    failedTests,
    file,
    node,
    domain,
  );

  const prompt = `Repair ONE broken source file. Do not reference other files.

Domain: ${domain}
Path: ${file.path}
Node id: ${node?.id || 'unknown'}
Node type: ${node?.type || 'unknown'}
Required language: ${language}

${instructions}

Broken file content:
${(file.content || '').slice(0, 2500)}

Return ONLY the complete fixed file source. No markdown fences. No explanation.`;

  return generateText(prompt, { maxTokens: 2000, temperature: 0.1 });
}
