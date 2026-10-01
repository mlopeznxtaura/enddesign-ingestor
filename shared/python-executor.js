/**
 * Python bricklayer bridge — spawns agent/cad_executor.py with manifest JSON on stdin.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Templates implemented in cad_executor.py (JS handles the rest). */
export const PYTHON_BRICKLAYER_TEMPLATES = new Set([
  'python_stl_export',
  'ts_config',
  'ts_action_handler',
  'react_viewport_r3f',
]);

const DEFAULT_TIMEOUT_MS = 15000;

function defaultExecutorPath() {
  return join(__dirname, '..', 'agent', 'cad_executor.py');
}

function pythonCommand() {
  return process.env.PYTHON_BRICKLAYER || (process.platform === 'win32' ? 'python' : 'python3');
}

export function isPythonBricklayerAvailable(scriptPath = defaultExecutorPath()) {
  return existsSync(scriptPath);
}

export function shouldUsePythonBricklayer(entry) {
  return Boolean(
    entry?.templateType &&
    entry?.deterministic &&
    PYTHON_BRICKLAYER_TEMPLATES.has(entry.templateType),
  );
}

/**
 * Run cad_executor.py — returns generated source or throws.
 */
export function executeCadPython(entry, options = {}) {
  const scriptPath = options.scriptPath ?? defaultExecutorPath();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pythonCmd = options.pythonCmd ?? pythonCommand();

  if (!existsSync(scriptPath)) {
    throw new Error(`cad_executor.py not found at ${scriptPath}`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGTERM');
        reject(new Error(`cad_executor timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `cad_executor exited with code ${code}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error('cad_executor returned empty output'));
        return;
      }
      resolve(stdout);
    });

    proc.stdin.write(JSON.stringify(entry));
    proc.stdin.end();
  });
}

/**
 * Health probe — runs python --version + script exists.
 */
export async function checkPythonBricklayerHealth() {
  const scriptPath = defaultExecutorPath();
  const available = existsSync(scriptPath);
  if (!available) {
    return { ok: false, available: false, scriptPath, hint: 'agent/cad_executor.py missing' };
  }

  const pythonCmd = pythonCommand();
  try {
    const version = await runQuick(pythonCmd, ['--version'], 5000);
    return {
      ok: true,
      available: true,
      scriptPath,
      python: version.trim(),
      templates: [...PYTHON_BRICKLAYER_TEMPLATES],
    };
  } catch (e) {
    return { ok: false, available: true, scriptPath, error: e.message };
  }
}

function runQuick(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('timeout'));
    }, timeoutMs);
    proc.stdout.on('data', (d) => {
      out += d;
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`exit ${code}`));
      else resolve(out);
    });
    proc.on('error', reject);
  });
}
