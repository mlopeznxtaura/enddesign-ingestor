import { spawn } from 'child_process';
import os from 'os';

/**
 * Dev Server Launcher
 * Starts both the FastAPI Agent Bridge and the Vite Frontend in parallel.
 */

console.log('🚀 Starting NextAura EndDesign Suite...');

// 1. Start Python Agent API
const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
const agentApi = spawn(pythonCmd, ['-m', 'agent.api'], { 
  stdio: 'inherit'
});

agentApi.on('error', (err) => {
  console.error('❌ Failed to start Agent API:', err.message);
  console.log('💡 Ensure Python is installed and agent/api.py exists.');
});

// 2. Start Vite Frontend
const vite = spawn('npx', ['vite'], { 
  stdio: 'inherit',
  shell: true 
});

vite.on('error', (err) => {
  console.error('❌ Failed to start Vite:', err.message);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  agentApi.kill();
  vite.kill();
  process.exit();
});

process.on('exit', () => {
  agentApi.kill();
  vite.kill();
});
