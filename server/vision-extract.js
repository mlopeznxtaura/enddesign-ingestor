/**
 * Vision extract — Gemini multimodal when available, else watsonx text fallback.
 */
import { parseVisionElements } from '../shared/structure-extract.js';
import { generateText } from './ibm-watsonx.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const PROJECT = 'nextaura-core';
const LOCATION = 'us-central1';
const GEMINI_URL = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/gemini-2.0-flash:generateContent`;

const VISION_PROMPT = `Analyze this UI screenshot/mockup. Extract ALL functional elements.

Return ONLY valid JSON (no markdown):
{
  "appTitle": "app name from header if visible",
  "elements": [
    {
      "type": "panel|button|input|viewport|code-editor|nav",
      "label": "visible label text",
      "identifier": "slug-id",
      "description": "what it does",
      "value": "default value if input"
    }
  ],
  "materials": ["material names if shown"],
  "codeSnippet": "any code text visible in editor areas"
}

Be precise. Map columns, parameter groups, buttons, 3D viewport, code editor.`;

async function getGcpAccessToken() {
  if (GEMINI_KEY) return GEMINI_KEY;
  try {
    const { execSync } = await import('child_process');
    return execSync('gcloud auth print-access-token 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

export async function extractFromImage(base64, mimeType = 'image/png') {
  const token = await getGcpAccessToken();
  if (token) {
    try {
      const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: VISION_PROMPT },
              { inlineData: { mimeType, data: base64.replace(/^data:[^;]+;base64,/, '') } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
        }),
      });
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const structure = parseVisionElements(parsed);
        return { structure, source: 'gemini-vision', raw: parsed };
      }
    } catch (e) {
      console.warn('Gemini vision failed:', e.message);
    }
  }

  // Watsonx text-only fallback — weak for true images
  const hint = await generateText(
    'Describe a generic app UI with panels, inputs, and a build button as JSON elements array only.',
    { maxTokens: 800, temperature: 0.3 },
  );
  const jsonMatch = hint.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    const structure = parseVisionElements(parsed);
    structure.confidence = 0.35;
    return { structure, source: 'watsonx-fallback', raw: parsed };
  }

  throw new Error('Vision extract failed — paste HTML or enable Gemini API');
}
