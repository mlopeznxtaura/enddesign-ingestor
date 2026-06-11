/**
 * NextAura EndDesign Server — serves frontend + Gemini API proxy.
 * One container, one deploy. Hackathon-ready.
 */
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const PROJECT = 'nextaura-core';
const LOCATION = 'us-central1';
const GEMINI_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash:generateContent`;

// ── Serve frontend static files ──
app.use(express.static(join(__dirname, 'dist')));

// ── Gemini API proxy ──
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, image, temperature = 0.7 } = req.body;
    
    const parts = [{ text: prompt }];
    if (image) {
      parts.push({ 
        inlineData: { 
          mimeType: 'image/png', 
          data: image 
        } 
      });
    }

    // Get access token
    const token = await getAccessToken();
    
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature,
          maxOutputTokens: 4096,
          topP: 0.95,
        },
      }),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    res.json({ text, raw: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Build UI endpoints (stubbed for demo) ──
let buildState = { status: 'idle', logs: [], completedTasks: 0, totalTasks: 14 };

app.post('/start', (req, res) => {
  buildState.status = 'running';
  buildState.logs = [];
  // Simulate build progress
  let task = 0;
  const interval = setInterval(() => {
    task++;
    buildState.completedTasks = task;
    buildState.logs.push({ 
      timestamp: new Date().toISOString(), 
      message: `[TASK ${task}/14] Building component ${task}...`,
      level: 'info'
    });
    if (task >= 14) {
      buildState.status = 'done';
      buildState.logs.push({ 
        timestamp: new Date().toISOString(), 
        message: 'Build complete! All 14 tasks finished.',
        level: 'success'
      });
      clearInterval(interval);
    }
  }, 500);
  res.json({ success: true, status: 'running' });
});

app.post('/stop', (req, res) => {
  buildState.status = 'idle';
  res.json({ success: true, status: 'idle' });
});

app.get('/status', (req, res) => {
  res.json(buildState);
});

// ── SPA fallback ──
app.use((req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ── Get GCP access token ──
async function getAccessToken() {
  if (GEMINI_KEY) return GEMINI_KEY;
  try {
    const { execSync } = await import('child_process');
    return execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

app.listen(PORT, () => {
  console.log(`NextAura EndDesign running on port ${PORT}`);
  console.log(`Gemini proxy: /api/gemini`);
  console.log(`Build API: /start /stop /status`);
});