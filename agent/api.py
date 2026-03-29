"""
NextAura Agent API — FastAPI server for bridging the autonomous builder to the GUI.
Provides process control and real-time log streaming via WebSockets.
"""

import os
import subprocess
import threading
import asyncio
import json
import time
from typing import Dict, List, Any, Optional, Union
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from pathlib import Path

# Setup logging
from .logger import setup_logger
logger = setup_logger(__name__)

app = FastAPI(title="NextAura Agent API")

# Enable CORS for the Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global process management
class AgentProcessManager:
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.status = "idle"  # idle, running, done, error
        self.logs: List[Dict[str, Any]] = []
        self.log_file = Path("agent.log")
        self.clients: List[WebSocket] = []
        self._log_watcher_thread: Optional[threading.Thread] = None
        self._stop_watcher = False

    def start_agent(self, resume: bool = True) -> bool:
        if self.process and self.process.poll() is None:
            logger.warning("Agent already running")
            return False

        # Use full module path for reliability
        cmd = ["python", "-m", "agent.python_agent"]
        if resume:
            cmd.append("--resume")

        try:
            # Clear internal log buffer for new run
            if not resume:
                self.logs.clear()

            self.process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True
            )
            self.status = "running"
            logger.info(f"Agent started with command: {' '.join(cmd)}")
            
            # Start log watcher
            self._stop_watcher = False
            self._log_watcher_thread = threading.Thread(target=self._watch_logs, daemon=True)
            self._log_watcher_thread.start()
                
            return True
        except Exception as e:
            logger.error(f"Failed to start agent: {e}")
            self.status = "error"
            return False

    def stop_agent(self):
        if self.process and self.process.poll() is None:
            logger.info("Stopping agent process")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.status = "idle"
            self._stop_watcher = True
            return True
        return False

    def _watch_logs(self):
        """Watch the agent stdout and broadcast to WS clients."""
        logger.info("Log watcher started")
        
        if not self.process or not self.process.stdout:
            logger.error("No process stdout to watch")
            return

        # Use iter to read lines safely
        for line in iter(self.process.stdout.readline, ''):
            if self._stop_watcher:
                break
            
            clean_line = line.strip()
            if not clean_line:
                continue

            log_entry = {
                "id": time.time(),
                "message": clean_line,
                "level": self._detect_level(clean_line),
                "timestamp": time.time() * 1000
            }
            self.logs.append(log_entry)

        # Process finished
        if self.process:
            return_code = self.process.wait()
            self.status = "done" if return_code == 0 else "error"
            logger.info(f"Agent process finished with code {return_code}")
            
            finish_entry = {
                "id": time.time(),
                "message": f"Agent loop finished: {self.status.upper()}",
                "level": "success" if return_code == 0 else "error",
                "timestamp": time.time() * 1000
            }
            self.logs.append(finish_entry)

    def _detect_level(self, line: str) -> str:
        line_lower = line.lower()
        if "error" in line_lower: return "error"
        if "warning" in line_lower: return "warn"
        if "success" in line_lower or "complete" in line_lower: return "success"
        if "info" in line_lower: return "info"
        return "info"

manager = AgentProcessManager()

@app.get("/status")
async def get_status():
    is_running = manager.process.poll() is None if manager.process else False
    return {
        "status": manager.status,
        "running": is_running,
        "tasks_done": len([l for l in manager.logs if "Task completed" in l["message"]])
    }

@app.post("/start")
async def start_build(resume: bool = True):
    success = manager.start_agent(resume=resume)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to start agent")
    return {"message": "Agent started"}

@app.post("/stop")
async def stop_build():
    success = manager.stop_agent()
    return {"message": "Agent stopped", "success": success}

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    manager.clients.append(websocket)
    try:
        # Send history (last 100 lines)
        history = manager.logs[-100:] if len(manager.logs) > 100 else manager.logs
        for log in history:
            await websocket.send_text(json.dumps(log))
            
        # Stream new logs
        last_idx = len(manager.logs)
        while True:
            if last_idx < len(manager.logs):
                # Send all new logs since last check
                new_logs = manager.logs[last_idx:]
                for log in new_logs:
                    await websocket.send_text(json.dumps(log))
                last_idx = len(manager.logs)
            
            # Check if process ended to close socket
            if manager.status in ["done", "error"] and last_idx >= len(manager.logs):
                break
                
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        if websocket in manager.clients:
            manager.clients.remove(websocket)
        logger.info("WS Client disconnected")
    except Exception as e:
        logger.error(f"WS Error: {e}")
        if websocket in manager.clients:
            manager.clients.remove(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
