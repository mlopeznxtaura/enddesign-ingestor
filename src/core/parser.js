// parser.js — converts design specs into layered DAGs
// Supports: HTML (data-key), JSON DAG

import { parseHTMLDOM, itemsToDAGLayers } from './html-dom-parser.js'
import { extractHTMLStructure } from '../../shared/structure-extract.js'
import { structureToDAGLayers } from '../../shared/structure-to-dag.js'

/**
 * Top-level entry. Returns an array of layers, each with { label, nodes[] }.
 * Layers ordered: UI → Functions → I/O → Root (root at bottom of visual stack).
 */
export function parseDesignToDAG(text, type = 'freeform') {
  if (!text || !text.trim()) return []

  // Detect HTML and use DOM parser
  if (isHTML(text)) {
    return parseHTMLWithDOM(text)
  }

  // JSON DAG format
  if (type === 'dag' || text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text)
      return buildFromJSONDAG(parsed)
    } catch (e) {
      console.warn('JSON parse failed:', e.message)
      return []
    }
  }

  // Freeform text — use simple line-based parsing
  return parseFreeformText(text)
}

/**
 * Check if text is HTML.
 */
function isHTML(text) {
  const trimmed = text.trim()
  return trimmed.startsWith('<') && (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('data-key=') ||
    trimmed.includes('<head>') ||
    trimmed.includes('<body>')
  )
}

/**
 * Parse HTML using DOM parser for data-key extraction.
 */
function parseHTMLWithDOM(text) {
  const result = parseHTMLDOM(text)
  if (result.items && result.items.length > 0) {
    return itemsToDAGLayers(result.items)
  }

  const structure = extractHTMLStructure(text)
  if (structure.columns.length || structure.parts.length || structure.params.length) {
    return structureToDAGLayers(structure)
  }

  return []
}

/**
 * Parse JSON DAG format.
 */
function buildFromJSONDAG(obj) {
  if (obj.nodes && Array.isArray(obj.nodes)) {
    const grouped = {}
    for (const n of obj.nodes) {
      const layer = n.layer || n.type || 'fn'
      if (!grouped[layer]) grouped[layer] = []
      grouped[layer].push({
        id: n.id || slugify(n.name || n.label),
        name: n.label || n.name || n.id,
        type: n.type || 'fn',
        desc: n.desc || n.description || '',
        layer,
        edges: n.edges || [],
      })
    }
    return Object.entries(grouped).map(([label, nodes]) => ({ label: humanizeLayer(label), nodes }))
  }
  return []
}

/**
 * Simple freeform text parser — splits by lines and creates basic nodes.
 */
function parseFreeformText(text) {
  const lines = text.split('\n').filter(l => l.trim())
  const nodes = lines.map((line, i) => ({
    id: `line_${i}`,
    name: line.substring(0, 50),
    type: 'fn',
    desc: line,
    layer: 'general',
    edges: []
  }))

  if (nodes.length === 0) return []

  return [
    { label: 'General Tasks', nodes }
  ]
}

// ── HELPERS ────────────────────────────────────────────────────────────
function slugify(str = '') {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 30)
}

function humanizeLayer(layer) {
  const map = {
    ui: 'UI / Surface',
    fn: 'Functions / Handlers',
    io: 'I/O / Boundaries',
    root: 'Root Capability',
    backend: 'Backend / Rust',
    integration: 'OAuth Integrations',
    step1: 'Step 1: Connect',
    step2: 'Step 2: Verify',
    step3: 'Step 3: Workflow',
    step4: 'Step 4: ROI',
    step5: 'Step 5: Entitlement',
    step6: 'Step 6: Scaffold',
    general: 'General Tasks'
  }
  return map[layer] || layer
}
