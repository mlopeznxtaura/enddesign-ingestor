/**
 * Code generation utilities — sanitize LLM output, pick paths, basic validation.
 */

export function stripMarkdownFences(text = '') {
  let out = text.trim();
  const fenceMatch = out.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenceMatch) out = fenceMatch[1].trim();
  out = out.replace(/^```\w*\s*/i, '').replace(/```\s*$/i, '').trim();
  out = out.replace(
    /^(No comments\.|No additional comments\.|Use functional components[^\n]*\n|The component should[^\n]*\n|Rules?:[\s\S]*?(?=import |export |\/\*\*|\/\/|const |function |class ))/i,
    '',
  );
  const codeStart = out.search(/^(import |export |\/\*\*|\/\/|const |function |class |@)/m);
  if (codeStart > 0) out = out.slice(codeStart);
  return out.trim();
}

function isReactContent(content = '') {
  return /import\s+React|from\s+['"]react['"]|<[A-Za-z]/.test(content);
}

function isPythonContent(content = '') {
  const t = content.trim();
  if (isReactContent(content)) return false;
  if (/^(import |from )/m.test(t)) return true;
  if (/^\w+\s*=\s*\{/.test(t)) return true;
  if (/^def\s+\w+/m.test(t)) return true;
  return false;
}

export function pickExtension(node, content = '', domain = 'app-ui') {
  if (isReactContent(content)) return 'tsx';
  if (isPythonContent(content)) return 'py';
  if (/export async function|export function/.test(content)) return 'ts';
  if (node.type === 'ui') return 'tsx';
  if (node.type === 'io' && (node.id?.includes('stl') || domain === 'cad-stl')) return 'py';
  return 'ts';
}

export function filePathForNode(node, content = '', domain = 'app-ui') {
  const id = (node.id || 'component').replace(/[^\w-]/g, '_');
  const ext = pickExtension(node, content, domain);

  if (node.type === 'io') {
    const ioName = node.id?.includes('stl') ? 'stl_export' : id;
    return `src/io/${ioName}.${ext}`;
  }
  if (node.type === 'root') return 'src/AppShell.tsx';
  if (node.type === 'ui') return `src/components/${id}.tsx`;
  return `src/generated/${id}.${ext}`;
}

export function validateSyntax(content, ext) {
  if (!content?.trim()) return { ok: false, issues: ['empty file'] };

  const issues = [];
  if (content.includes('```')) issues.push('markdown fences remain');

  if (ext === 'py' && isReactContent(content)) {
    issues.push('python file contains React/JSX');
  }

  if (ext === 'tsx' || ext === 'ts' || ext === 'jsx' || ext === 'js') {
    const open = (content.match(/\{/g) || []).length;
    const close = (content.match(/\}/g) || []).length;
    if (open !== close) issues.push('unbalanced braces');

    const exportNames = [];
    const re = /export\s+(?:const|function|class)\s+(\w+)/g;
    let m;
    while ((m = re.exec(content)) !== null) exportNames.push(m[1]);
    const dupes = exportNames.filter((n, i) => exportNames.indexOf(n) !== i);
    if (dupes.length) issues.push(`duplicate export: ${[...new Set(dupes)].join(', ')}`);

    if (ext.includes('tsx') && content.includes('import React') && !content.includes('export')) {
      issues.push('missing export');
    }
  }

  return { ok: issues.length === 0, issues };
}

export function sanitizeGenerated(content, node, domain = 'app-ui') {
  const clean = stripMarkdownFences(content);
  const ext = pickExtension(node, clean, domain);
  const validation = validateSyntax(clean, ext);
  return { content: clean, ext, validation };
}
