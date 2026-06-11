"""
Gemini Coder — Generate code using Google Gemini Flash via Vertex AI.
Replaces Ollama llm_coder.py. Uses GCP access token for auth.
"""
import json
import urllib.request
import urllib.error
import os
from typing import Optional, Dict, Any, Tuple

from .logger import setup_logger
from .prompts import build_prompt, get_system_prompt

logger = setup_logger(__name__)

GEMINI_MODEL = "gemini-2.0-flash"
PROJECT = "nextaura-core"
LOCATION = "us-central1"
API_URL = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT}/locations/{LOCATION}/publishers/google/models/{GEMINI_MODEL}:generateContent"

MAX_RETRIES = 3

def _get_access_token():
    """Get GCP access token."""
    try:
        result = os.popen("gcloud auth print-access-token 2>/dev/null").read().strip()
        if result:
            return result
    except Exception:
        pass
    return os.environ.get("GCP_ACCESS_TOKEN", "")

class GeminiCoder:
    """Generate code using Gemini Flash via Vertex AI."""

    def __init__(self):
        self.token = _get_access_token()
        self.timeout = 60
        self.base_temperature = 0.7
        self.max_retries = MAX_RETRIES

    def _refresh_token(self):
        self.token = _get_access_token()

    def generate_code(self, task: Dict[str, Any], retry_count: int = 0,
                      previous_error: Optional[str] = None) -> Tuple[Optional[str], bool, int]:
        system_prompt = get_system_prompt(task)
        user_prompt = build_prompt(task, previous_error)
        full_prompt = f"{system_prompt}\n\n{user_prompt}"

        temperature = min(0.7 + (retry_count * 0.1), 0.9)

        try:
            response = self._call_gemini(full_prompt, temperature)
            if response:
                code = self._extract_code(response)
                if code:
                    return code, True, retry_count

            if retry_count < self.max_retries:
                logger.warning(f"Retry {retry_count + 1}/{self.max_retries} for task {task.get('id')}")
                return self.generate_code(task, retry_count + 1, "Previous response was empty or invalid")

            return None, False, retry_count
        except Exception as e:
            logger.error(f"Gemini error: {e}")
            if retry_count < self.max_retries:
                return self.generate_code(task, retry_count + 1, str(e))
            return None, False, retry_count

    def _call_gemini(self, prompt: str, temperature: float = 0.7) -> Optional[str]:
        if not self.token:
            self._refresh_token()
        
        payload = json.dumps({
            "contents": [{
                "role": "user",
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 4096,
                "topP": 0.95,
            }
        }).encode('utf-8')

        req = urllib.request.Request(API_URL, data=payload, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Bearer {self.token}')

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode())
                candidates = data.get('candidates', [])
                if candidates:
                    parts = candidates[0].get('content', {}).get('parts', [])
                    return ' '.join(p.get('text', '') for p in parts)
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ''
            logger.error(f"Gemini HTTP {e.code}: {body[:200]}")
            if e.code == 401:
                self._refresh_token()
        return None

    def _extract_code(self, text: str) -> Optional[str]:
        """Extract code blocks from Gemini response."""
        if '```' in text:
            parts = text.split('```')
            if len(parts) >= 2:
                code = parts[1]
                if '\n' in code and (code.startswith('python') or code.startswith('javascript') or code.startswith('js') or code.startswith('rust')):
                    code = code.split('\n', 1)[1] if '\n' in code else code
                return code.strip()
        return text.strip()