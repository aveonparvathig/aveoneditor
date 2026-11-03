/**
 * Markdown in and out, GitHub-flavoured: headings, emphasis, links, images, lists, task lists,
 * tables, quotes, code, math (`$…$`, `` $`…`$ ``, `$$…$$`, ```math) and diagrams (```mermaid,
 * ```geojson, ```topojson, ```stl).
 *
 * - `editor.plugins.get('Markdown').getMarkdown()` / `.setMarkdown(text)` / `.insertMarkdown(text)`
 * - Buttons: `exportMarkdown` (downloads a `.md` file) and `importMarkdown` (inserts a `.md` file)
 * - Pasting text that looks like Markdown (copied from GitHub, a README or a chat) converts it.
 *   Ctrl+Shift+V still pastes plain text.
 *
 *   markdown: { paste: 'auto' | 'always' | 'never', fileName: 'notes' }
 *
 * Formatting Markdown has no syntax for (colours, fonts, alignment) is not kept in the Markdown;
 * underline, subscript, superscript and highlight become `<ins>`, `<sub>`, `<sup>` and `<mark>`,
 * which GitHub shows.
 */

import { Marked, type Tokens } from 'marked';
import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { escapeHtml, downloadFile } from '../shared/upcast';
import { parseDelimitedEquation } from '../math/mathediting';
import { DIAGRAM_TYPES } from '../diagrams/diagrams';
import type { Editor } from '../../core/editor';

export interface MarkdownConfig {
  /** `auto` (default): convert pasted plain text that looks like Markdown; `always`; `never`. */
  paste?: 'auto' | 'always' | 'never';
  /** File name of the exported `.md` file, without extension. Default: `export.fileName` or `document`. */
  fileName?: string;
}

/* ------------------------------------------------------------------------------------------ */
/* Markdown → HTML                                                                             */
/* ------------------------------------------------------------------------------------------ */

const mathSpan = (equation: string, display: boolean) =>
  `<span class="math-tex">${display ? '\\[' : '\\('}${escapeHtml(equation.trim())}${display ? '\\]' : '\\)'}</span>`;

const markdown = new Marked({ gfm: true, breaks: false });
markdown.use({
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start: (src: string) => src.match(/^\$\$/m)?.index,
      tokenizer(src: string) {
        const match = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n+|$)/.exec(src);
        if (match && match[1].trim()) return { type: 'blockMath', raw: match[0], text: match[1] };
        return undefined;
      },
      renderer: (token: any) => mathSpan(token.text, true) + '\n'
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start(src: string) {
        const index = src.indexOf('$');
        return index < 0 ? undefined : index;
      },
      tokenizer(src: string) {
        const display = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (display && display[1].trim()) return { type: 'inlineMath', raw: display[0], text: display[1], display: true };
        const backtick = /^\$`([^`]+?)`\$/.exec(src);
        if (backtick) return { type: 'inlineMath', raw: backtick[0], text: backtick[1], display: false };
        // No space just inside the dollars, and a closing dollar not followed by a digit ("$5 and $10").
        const dollar = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?!\d)/.exec(src);
        if (dollar) return { type: 'inlineMath', raw: dollar[0], text: dollar[1], display: false };
        return undefined;
      },
      renderer: (token: any) => mathSpan(token.text, token.display)
    }
  ],
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
      if (lang === 'math') return mathSpan(token.text, true) + '\n';
      if ((DIAGRAM_TYPES as string[]).includes(lang)) {
        return `<figure class="diagram" data-diagram="${lang}"><pre><code class="language-${lang}">${escapeHtml(token.text)}</code></pre></figure>\n`;
      }
      return false;
    }
  }
});

/** Converts Markdown to the editor's HTML. */
export function markdownToHtml(text: string): string {
  const html = markdown.parse(text.replace(/\r\n?/g, '\n'), { async: false }) as string;
  // Task list text starts after the checkbox, not with the space that follows it.
  return html.replace(/(<input [^>]*type="checkbox"[^>]*>)[ \t]+/g, '$1');
}

/** Whether pasted plain text looks like Markdown (rather than ordinary text). */
export function looksLikeMarkdown(text: string): boolean {
  const signals = [
    /^#{1,6}\s+\S/m, // heading
    /^(`{3,}|~{3,})/m, // code fence
    /^\s*[-*+]\s+\[[ xX]\]\s/m, // task list
    /^\|.*\|\s*\n\|?\s*:?-{3,}/m, // table
    /^\$\$/m, // display math
    /\*\*[^*\n]+\*\*|__[^_\n]+__/, // bold
    /\[[^\]\n]+\]\([^)\s]+\)/, // link or image
    /^>\s+\S/m, // quote
    /\$`[^`\n]+`\$/, // inline math
    /(?:^|\s)\$[^\s$][^$\n]*[A-Za-z\\^_{}][^$\n]*[^\s\\$]\$(?!\d)/ // inline math
  ];
  if (signals.some(pattern => pattern.test(text))) return true;
  // Two or more list lines.
  return (text.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) || []).length >= 2;
}

/* ------------------------------------------------------------------------------------------ */
/* HTML → Markdown                                                                             */
/* ------------------------------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'TABLE', 'HR', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'MAIN', 'DL', 'ADDRESS']);
/** Placeholder for a literal dollar, settled per block (see `finishBlock`). */
const DOLLAR = '\u0000D\u0000';

interface BlockState {
  hasMath: boolean;
}

/** An equation element's TeX and mode, or `null` when `element` is not an equation. */
function equationOf(element: Element): { equation: string; display: boolean } | null {
  const tag = element.tagName;
  if (tag === 'SPAN' && element.classList.contains('math-tex')) return parseDelimitedEquation(element.textContent || '');
  if (tag === 'SCRIPT' && /^math\/tex/.test(element.getAttribute('type') || '')) {
    return { equation: (element.textContent || '').trim(), display: /mode=display/.test(element.getAttribute('type') || '') };
  }
  if (tag === 'IMG' && element.classList.contains('math-tex') && element.hasAttribute('data-equation')) {
    return { equation: element.getAttribute('data-equation') || '', display: element.classList.contains('math-tex-display') };
  }
  if (tag.toLowerCase() === 'math') {
    const annotation = element.querySelector('annotation[encoding="application/x-tex"]');
    return { equation: (annotation?.textContent || element.textContent || '').trim(), display: element.getAttribute('display') === 'block' };
  }
  return null;
}

function isBlock(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  if (BLOCK_TAGS.has(element.tagName)) return true;
  const equation = equationOf(element);
  return !!equation && equation.display;
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]<>~|])/g, '\\$1')
    .replace(/\$/g, DOLLAR);
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function codeFence(text: string, lang: string): string {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) || []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text.replace(/\n$/, '')}\n${fence}`;
}

function inlineMath(equation: string): string {
  if (/\$|^\s|\s$/.test(equation) && !equation.includes('`')) return `$\`${equation}\`$`;
  return `$${equation}$`;
}

/** Wraps `inner` in `marker`s, keeping surrounding spaces outside (`** bold **` is not bold). */
function wrap(inner: string, marker: string, close = marker): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return match[2] ? `${match[1]}${marker}${match[2]}${close}${match[3]}` : inner;
}

function renderInline(nodes: Iterable<Node>, state: BlockState): string {
  let out = '';
  for (const node of nodes) {
    if (node.nodeType === 3) {
      out += escapeText((node.textContent || '').replace(/[ \t\r\n]+/g, ' '));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const equation = equationOf(element);
    if (equation) {
      state.hasMath = true;
      out += equation.display ? `$$${equation.equation}$$` : inlineMath(equation.equation);
      continue;
    }
    const inner = () => renderInline(element.childNodes, state);
    switch (element.tagName) {
      case 'STRONG':
      case 'B':
        out += wrap(inner(), '**');
        break;
      case 'EM':
      case 'I':
        out += wrap(inner(), '*');
        break;
      case 'S':
      case 'DEL':
      case 'STRIKE':
        out += element.classList.contains('suggestion-delete') ? inner() : wrap(inner(), '~~');
        break;
      case 'U':
        out += wrap(inner(), '<ins>', '</ins>');
        break;
      case 'INS':
        out += element.classList.contains('suggestion-insert') ? inner() : wrap(inner(), '<ins>', '</ins>');
        break;
      case 'SUB':
      case 'SUP':
      case 'MARK':
      case 'KBD': {
        const tag = element.tagName.toLowerCase();
        // Footnote references keep only their number.
        out += element.classList.contains('footnote-ref') ? `[^${element.textContent?.replace(/\D/g, '') || '1'}]` : wrap(inner(), `<${tag}>`, `</${tag}>`);
        break;
      }
      case 'CODE':
        out += codeSpan(element.textContent || '');
        break;
      case 'A': {
        const href = element.getAttribute('href') || '';
        const text = inner();
        const title = element.getAttribute('title');
        if (!href) out += text;
        else out += `[${text || href}](${/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
        break;
      }
      case 'IMG': {
        const src = element.getAttribute('src') || '';
        if (src) out += `![${escapeText(element.getAttribute('alt') || '').replace(new RegExp(DOLLAR, 'g'), '$')}](${/[\s()<>]/.test(src) ? `<${src}>` : src})`;
        break;
      }
      case 'BR':
        out += '\\\n';
        break;
      case 'INPUT':
      case 'SCRIPT':
      case 'STYLE':
        break;
      default:
        out += inner();
    }
  }
  return out;
}

/** Settles literal dollars: next to math GitHub needs `<span>$</span>`, elsewhere `$` is fine. */
function finishBlock(text: string, state: BlockState): string {
  const count = text.split(DOLLAR).length - 1;
  return text.replace(new RegExp(DOLLAR, 'g'), state.hasMath || count > 1 ? '<span>$</span>' : '$');
}

function paragraph(nodes: Node[]): string {
  const state: BlockState = { hasMath: false };
  const text = renderInline(nodes, state)
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (!text) return '';
  // A line starting like a heading, quote, list or rule would change meaning; escape it.
  return finishBlock(text, state)
    .split('\n')
    .map(line => line.replace(/^(#{1,6}\s|[-+]\s|-{3,}\s*$|={3,}\s*$)/, '\\$1').replace(/^(\d+)([.)]\s)/, '$1\\$2'))
    .join('\n');
}

function indent(text: string, prefix: string, first = prefix): string {
  return text
    .split('\n')
    .map((line, i) => (line ? (i ? prefix : first) + line : line))
    .join('\n');
}

function renderBlocks(nodes: Iterable<Node>): string[] {
  const out: string[] = [];
  let inline: Node[] = [];
  const flush = () => {
    const text = paragraph(inline);
    if (text) out.push(text);
    inline = [];
  };
  for (const node of nodes) {
    if (!isBlock(node)) {
      inline.push(node);
      continue;
    }
    flush();
    const block = renderBlock(node as Element);
    if (block) out.push(block);
  }
  flush();
  return out;
}

function renderBlock(element: Element): string {
  const equation = equationOf(element);
  if (equation) return `$$\n${equation.equation}\n$$`;
  const tag = element.tagName;
  switch (tag) {
    case 'P':
      return paragraph([...element.childNodes]);
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const text = paragraph([...element.childNodes]).replace(/\n/g, ' ');
      return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
    }
    case 'HR':
      return '---';
    case 'BLOCKQUOTE':
      return indent(renderBlocks(element.childNodes).join('\n\n'), '> ').replace(/^$/gm, '>');
    case 'PRE': {
      const code = element.querySelector('code');
      const language = [...(code || element).classList].map(name => /^language-(.+)$/.exec(name)?.[1]).find(Boolean) || '';
      return codeFence((code || element).textContent || '', language === 'plaintext' ? '' : language);
    }
    case 'UL':
    case 'OL':
      return renderList(element);
    case 'TABLE':
      return renderTable(element);
    case 'FIGURE':
      return renderFigure(element);
    case 'NAV':
      // A table of contents is generated from the headings.
      return element.classList.contains('table-of-contents') ? '' : renderBlocks(element.childNodes).join('\n\n');
    default:
      return renderBlocks(element.childNodes).join('\n\n');
  }
}

function renderList(list: Element): string {
  const ordered = list.tagName === 'OL';
  let number = Number(list.getAttribute('start')) || 1;
  const items: string[] = [];
  for (const item of [...list.children].filter(child => child.tagName === 'LI')) {
    const checkbox = item.querySelector(':scope > input[type="checkbox"], :scope > label > input[type="checkbox"]');
    let marker = ordered ? `${number++}. ` : '- ';
    if (checkbox) marker += (checkbox as HTMLInputElement).hasAttribute('checked') ? '[x] ' : '[ ] ';
    // Task list labels wrap the text; read through them.
    const nodes = [...item.childNodes].flatMap(child => (child.nodeType === 1 && (child as Element).tagName === 'LABEL' ? [...child.childNodes] : [child]));
    const body = renderBlocks(nodes).join('\n\n') || '';
    items.push(indent(body, ' '.repeat(ordered ? marker.replace(/\[.\] $/, '').length : 2), marker) || marker.trimEnd());
  }
  return items.join('\n');
}

function renderTable(table: Element): string {
  const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
  if (!rows.length) return '';
  const cells = rows.map(row => [...row.children].filter(cell => cell.tagName === 'TD' || cell.tagName === 'TH'));
  const simple = cells.every(row => row.every(cell => !cell.hasAttribute('colspan') && !cell.hasAttribute('rowspan') && !cell.querySelector('ul, ol, table, pre, blockquote, figure, h1, h2, h3, h4, h5, h6')));
  if (!simple) return table.outerHTML;
  const width = Math.max(...cells.map(row => row.length));
  const text = (cell: Element | undefined) =>
    cell
      ? renderBlocks(cell.childNodes)
          .join('<br>')
          .replace(/\n/g, ' ')
          .replace(/\|/g, '\\|')
      : '';
  const line = (row: Element[]) => `| ${Array.from({ length: width }, (_, i) => text(row[i])).join(' | ')} |`;
  return [line(cells[0]), `|${' --- |'.repeat(width)}`, ...cells.slice(1).map(line)].join('\n');
}

function renderFigure(figure: Element): string {
  if (figure.classList.contains('diagram')) {
    const type = figure.getAttribute('data-diagram') || '';
    return codeFence(figure.querySelector('code')?.textContent || figure.textContent || '', type);
  }
  const caption = figure.querySelector(':scope > figcaption');
  const captionText = caption ? paragraph([...caption.childNodes]) : '';
  const media = figure.querySelector('oembed[url]');
  let body: string;
  if (media) body = `<${media.getAttribute('url')}>`;
  else if (figure.classList.contains('sketch')) body = figure.innerHTML;
  else body = renderBlocks([...figure.childNodes].filter(node => node !== caption)).join('\n\n');
  return [body, captionText && `*${captionText}*`].filter(Boolean).join('\n\n');
}

/** Converts editor HTML to GitHub-flavoured Markdown. */
export function htmlToMarkdown(html: string, ownerDocument: Document = document): string {
  const doc = ownerDocument.implementation.createHTMLDocument('');
  doc.body.innerHTML = html;
  const text = renderBlocks(doc.body.childNodes).join('\n\n');
  return text ? text.replace(/\n{3,}/g, '\n\n') + '\n' : '';
}

/* ------------------------------------------------------------------------------------------ */
/* Plugin                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export class ExportMarkdownCommand extends Command {
  constructor(editor: Editor) {
    super(editor);
    this.affectsData = false;
  }

  public override refresh(): void {
    this.isEnabled = true;
  }

  /** Downloads the document as a `.md` file; returns the Markdown. */
  public override execute(): string {
    const editor = this.editor;
    const text = (editor.plugins.get('Markdown') as Markdown).getMarkdown();
    const config = (editor.config.get('markdown') as MarkdownConfig | undefined) || {};
    const fileName = config.fileName || (editor.config.get('export.fileName') as string | undefined) || 'document';
    downloadFile(text, `${fileName}.md`, 'text/markdown');
    return text;
  }
}

export class ImportMarkdownCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    this.isEnabled = !!model.schema.findAllowedParent(model.document.selection.getFirstPosition()!, 'paragraph');
  }

  /** Inserts `markdown` at the selection, or asks for a `.md` file. */
  public override async execute(options: { markdown?: string } = {}): Promise<void> {
    const plugin = this.editor.plugins.get('Markdown') as Markdown;
    const text = options.markdown ?? (await pickTextFile(this.editor));
    if (text) plugin.insertMarkdown(text);
  }
}

function pickTextFile(editor: Editor): Promise<string | null> {
  const doc = editor.ui.element?.ownerDocument || document;
  return new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    doc.body.appendChild(input);
    input.click();
  });
}

export class Markdown extends Plugin {
  public static override get pluginName(): string {
    return 'Markdown';
  }

  /** The document as GitHub-flavoured Markdown. */
  public getMarkdown(): string {
    const doc = this.editor.ui.element?.ownerDocument || document;
    return htmlToMarkdown(this.editor.getData(), doc);
  }

  /** Replaces the document with `text`. */
  public setMarkdown(text: string): void {
    this.editor.setData(markdownToHtml(text));
  }

  /** Inserts `text` at the selection (one undo step). */
  public insertMarkdown(text: string): void {
    const editor = this.editor;
    const content = editor.data.toModel(editor.data.htmlProcessor.toView(markdownToHtml(text)), '$clipboardHolder');
    editor.model.change(() => editor.model.insertContent(content));
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const config = (editor.config.get('markdown') as MarkdownConfig | undefined) || {};

    editor.commands.add('exportMarkdown', new ExportMarkdownCommand(editor));
    editor.commands.add('importMarkdown', new ImportMarkdownCommand(editor));
    const buttons: Array<[string, string]> = [
      ['exportMarkdown', t('Export to Markdown')],
      ['importMarkdown', t('Insert Markdown file')]
    ];
    for (const [name, label] of buttons) {
      editor.ui.componentFactory.add(name, locale => {
        const button = new ButtonView(locale);
        button.set({ label, icon: icons.markdown, tooltip: true });
        button.bind('isEnabled').to(editor.commands.get(name)!, 'isEnabled');
        this.listenTo(button, 'execute', () => editor.execute(name));
        return button;
      });
    }

    // Pasted Markdown. Runs before the clipboard pipeline turns plain text into paragraphs.
    const mode = config.paste || 'auto';
    if (mode === 'never') return;
    const viewDocument = editor.editing.view.document;
    let plainPaste = false;
    this.listenTo(viewDocument, 'keydown', (evt, data: any) => {
      plainPaste = !!data.shiftKey && (data.ctrlKey || data.metaKey);
    });
    this.listenTo(viewDocument, 'clipboardInput', (evt, data: any) => {
      const dataTransfer = data.dataTransfer;
      if (data.content || plainPaste || data.method === 'drop' || dataTransfer.getData('text/html')) return;
      const text = dataTransfer.getData('text/plain');
      if (!text || (mode === 'auto' && !looksLikeMarkdown(text))) return;
      // Inside a code block, text is code.
      if (editor.model.document.selection.getFirstPosition()?.parent.is('element', 'codeBlock')) return;
      data.content = editor.data.htmlProcessor.toView(markdownToHtml(text));
    });
  }
}
