#!/usr/bin/env node
/**
 * One-click report export: SUBMISSION_REPORT.md → SUBMISSION_REPORT.html (print-styled) → PocketChaos_Submission_Report.pdf
 *
 *   npm run export:pdf            (from submission-assets/)
 *   node submission-assets/export-pdf.mjs
 *
 * Zero dependencies. The PDF is printed by a locally installed Chrome, Chromium, Edge or Brave in headless mode
 * (override with CHROME_PATH=/path/to/browser). Without a browser it still writes the HTML: open it and use the
 * "Print / Save as PDF" button. The Markdown renderer supports exactly what the report uses: headings, paragraphs,
 * bold/italic/code/links, flat lists, tables, blockquotes, fenced code blocks and rules.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, 'SUBMISSION_REPORT.md');
const HTML_OUT = join(HERE, 'SUBMISSION_REPORT.html');
const PDF_OUT = join(HERE, 'PocketChaos_Submission_Report.pdf');

// ------------------------------------------------------------------------------------------------ Markdown → HTML

const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
}

/** Splits a table row on pipes that are not inside a code span. */
function splitRow(line) {
  const cells = [];
  let cell = '';
  let inCode = false;
  for (const char of line.trim().replace(/^\||\|$/g, '')) {
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function renderTable(lines) {
  const header = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  const headless = header.every((cell) => cell === '');
  const thead = headless ? '' : `<thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('\n');
  return `<table class="${headless ? 'kv' : ''}">${thead}<tbody>${body}</tbody></table>`;
}

const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body = [];
      for (i += 1; i < lines.length && !/^```/.test(lines[i]); i += 1) body.push(lines[i]);
      i += 1;
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = inline(line.slice(level + 1).trim());
      html.push(`<h${level} id="${slug(text)}">${text}</h${level}>`);
      i += 1;
    } else if (/^---+\s*$/.test(line)) {
      html.push('<hr>');
      i += 1;
    } else if (/^\|/.test(line) && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1] ?? '')) {
      const block = [];
      while (i < lines.length && /^\|/.test(lines[i])) block.push(lines[(i += 1) - 1]);
      html.push(renderTable(block));
    } else if (/^> ?/.test(line)) {
      const block = [];
      while (i < lines.length && /^> ?/.test(lines[i])) block.push(lines[(i += 1) - 1].replace(/^> ?/, ''));
      html.push(`<blockquote>${block.map(inline).join('<br>')}</blockquote>`);
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.) /, '');
        for (i += 1; i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.) /.test(lines[i]); i += 1) item += ` ${lines[i].trim()}`;
        items.push(`<li>${inline(item)}</li>`);
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (line.trim() === '') {
      i += 1;
    } else {
      const block = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6} |```|> ?|\||---+\s*$|\s*([-*]|\d+\.) )/.test(lines[i])) {
        block.push(lines[(i += 1) - 1].trim());
      }
      html.push(`<p>${inline(block.join(' '))}</p>`);
    }
  }
  return html.join('\n');
}

// ------------------------------------------------------------------------------------------------ page template

const STYLE = `
  :root { --ink: #0f172a; --body: #334155; --muted: #64748b; --line: #e2e8f0; --soft: #f8fafc; --accent: #0891b2; --accent-2: #7c3aed; }
  * { box-sizing: border-box; }
  html { background: #e9eef4; }
  body { margin: 0; color: var(--body); font: 10.5pt/1.55 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 210mm; margin: 24px auto; padding: 18mm 17mm; background: #fff; box-shadow: 0 10px 40px rgba(15, 23, 42, .12); }
  h1 { color: var(--ink); font-size: 26pt; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 10pt; padding-top: 6pt; border-top: 5pt solid var(--accent); }
  h1 + blockquote { border: 0; padding: 0; margin: 0 0 16pt; color: var(--muted); font-size: 11.5pt; background: none; }
  h1 + blockquote strong { color: var(--ink); font-size: 14pt; display: inline-block; margin-bottom: 2pt; }
  h2 { color: var(--ink); font-size: 15.5pt; letter-spacing: -0.01em; margin: 20pt 0 8pt; padding-bottom: 4pt; border-bottom: 1.5pt solid var(--line); break-after: avoid; }
  h3 { color: var(--ink); font-size: 11.5pt; margin: 14pt 0 5pt; break-after: avoid; }
  p { margin: 0 0 7pt; }
  strong { color: var(--ink); }
  a { color: var(--accent); text-decoration: none; }
  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin: 0 0 3pt; }
  code { font: 9pt/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #f1f5f9; color: #0f172a; padding: 0 2pt; border-radius: 3pt; }
  td:first-child code { white-space: nowrap; }
  pre { background: #0f172a; color: #e2e8f0; padding: 10pt 12pt; border-radius: 6pt; overflow-x: auto; break-inside: avoid; margin: 6pt 0 10pt; }
  pre code { background: none; color: inherit; padding: 0; font-size: 8.4pt; line-height: 1.35; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0 12pt; font-size: 9.4pt; line-height: 1.45; }
  th { text-align: left; color: var(--ink); background: var(--soft); font-weight: 650; border-bottom: 1.5pt solid #cbd5e1; padding: 5pt 7pt; }
  td { border-bottom: 0.75pt solid var(--line); padding: 5pt 7pt; vertical-align: top; }
  tr { break-inside: avoid; }
  table.kv td:first-child { width: 24%; color: var(--ink); white-space: nowrap; }
  table.kv { background: var(--soft); border-radius: 6pt; overflow: hidden; }
  table.kv td { border-bottom-color: #e8edf3; }
  blockquote { margin: 8pt 0; padding: 8pt 12pt; border-left: 3pt solid var(--accent-2); background: var(--soft); }
  hr { border: 0; border-top: 1pt solid var(--line); margin: 16pt 0; }
  .toolbar { position: fixed; top: 14px; right: 14px; display: flex; gap: 8px; }
  .toolbar button { font: 600 13px/1 ui-sans-serif, -apple-system, sans-serif; border: 0; border-radius: 999px; padding: 10px 16px; background: var(--accent); color: #fff; cursor: pointer; box-shadow: 0 6px 18px rgba(8, 145, 178, .3); }
  @page { size: A4; margin: 16mm 15mm 17mm; @bottom-right { content: "PocketChaos · Submission Report · " counter(page) " / " counter(pages); font: 8pt ui-sans-serif, -apple-system, sans-serif; color: #94a3b8; } }
  @media print {
    html { background: #fff; }
    main { margin: 0; padding: 0; max-width: none; box-shadow: none; }
    .toolbar { display: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }`;

function page(bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PocketChaos — Submission Report</title>
<!-- Generated by export-pdf.mjs from SUBMISSION_REPORT.md. Edit the Markdown, then re-run npm run export:pdf. -->
<style>${STYLE}</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Print / Save as PDF</button></div>
<main>
${bodyHtml}
</main>
</body>
</html>
`;
}

// ------------------------------------------------------------------------------------------------ PDF via headless browser

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function printToPdf(browser, htmlPath, pdfPath) {
  const profile = mkdtempSync(join(tmpdir(), 'pocketchaos-pdf-'));
  try {
    execFileSync(
      browser,
      ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${profile}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
      { stdio: 'ignore', timeout: 120_000 },
    );
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------

const markdown = readFileSync(SOURCE, 'utf8');
writeFileSync(HTML_OUT, page(markdownToHtml(markdown)));
console.log(`✓ HTML  ${HTML_OUT}`);

const browser = findBrowser();
if (!browser) {
  console.log('! No Chrome/Chromium/Edge/Brave found (set CHROME_PATH). Open the HTML file and click "Print / Save as PDF".');
} else {
  printToPdf(browser, HTML_OUT, PDF_OUT);
  if (!existsSync(PDF_OUT)) throw new Error('The browser did not write the PDF.');
  console.log(`✓ PDF   ${PDF_OUT}`);
}
