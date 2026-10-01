#!/usr/bin/env python3
"""
CAD deterministic executor — Stage 4 Python bricklayer (stdin JSON manifest entry → stdout source).

Usage:
  python agent/cad_executor.py < manifest_entry.json
  echo '{"templateType":"python_stl_export"}' | python agent/cad_executor.py
"""

import json
import sys
from pathlib import Path

STL_EXPORT_TEMPLATE = '''"""STL export — build123d parametric wheel stub."""
from build123d import *

def export_stl(params: dict, output_path: str = "wheel.stl") -> str:
    outer = float(params.get("outer_diameter", 120)) / 2
    width = float(params.get("rim_width", 8))
    wheel = Cylinder(radius=outer, height=width)
    export_stl(wheel, output_path)
    return output_path
'''


def generate_ts_config(entry: dict) -> str:
    prefix = entry.get("configPrefix") or entry.get("taskId", "config")
    params = entry.get("params") or []
    keys = entry.get("configKeys") or []
    lines = []
    label_lines = []
    if params:
        for p in params:
            label = p.get("label", p.get("id", "key"))
            key = label.split()[0].lower() if label else "value"
            val = p.get("value", "0")
            try:
                num = float(val)
                lines.append(f"  {key}: {num},")
            except (TypeError, ValueError):
                lines.append(f"  {key}: '{val}',")
            label_lines.append(f"  {key}: '{label}',")
    else:
        for k in keys:
            lines.append(f"  {k}: 0,")
            label_lines.append(f"  {k}: '{k}',")
    type_name = "".join(w.capitalize() for w in prefix.split("_"))
    return f"""/** Deterministic config — {prefix} */
export const {prefix}Defaults = {{
{chr(10).join(lines)}
}};

export const {prefix}Labels = {{
{chr(10).join(label_lines)}
}};

export type {type_name}Config = typeof {prefix}Defaults;
"""


def to_camel(s: str) -> str:
    parts = s.replace("-", "_").split("_")
    if not parts:
        return s
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def generate_action_handler(entry: dict) -> str:
    task_id = entry.get("taskId", "action")
    name = entry.get("desc", task_id)
    fn = to_camel(task_id.replace("-", "_")) + "_handler"
    return f'''/**
 * Action handler: {name}
 */
export async function {fn}(input: Record<string, unknown> = {{}}) {{
  return {{ ok: true, action: '{task_id}', input }};
}}
'''


def generate(entry: dict) -> str:
    template = entry.get("templateType", "")
    if template == "python_stl_export":
        return STL_EXPORT_TEMPLATE
    if template == "ts_config":
        return generate_ts_config(entry)
    if template == "ts_action_handler":
        return generate_action_handler(entry)
    if template == "react_viewport_r3f":
        title = entry.get("desc", "3D Viewport")
        return f'''import React, {{ Suspense }} from 'react';
import {{ Canvas }} from '@react-three/fiber';
import {{ OrbitControls }} from '@react-three/drei';

export function CenterViewport() {{
  return (
    <section className="center-viewport">
      <h2>{title}</h2>
      <Canvas camera={{ position: [2, 2, 2] }}>
        <ambientLight intensity={{0.6}} />
        <directionalLight position={{[4, 4, 4]}} />
        <Suspense fallback={{null}}>
          <mesh rotation={{[0.4, 0.4, 0]}}>
            <torusGeometry args={{[0.6, 0.15, 16, 48]}} />
            <meshStandardMaterial color="#4fd1c5" />
          </mesh>
        </Suspense>
        <OrbitControls />
      </Canvas>
    </section>
  );
}}
'''
    raise ValueError(f"No Python template for: {template}")


def main() -> None:
    raw = sys.stdin.read()
    entry = json.loads(raw)
    code = generate(entry)
    sys.stdout.write(code)


if __name__ == "__main__":
    main()
