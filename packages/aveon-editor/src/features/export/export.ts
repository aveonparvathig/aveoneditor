/**
 * Export the document as PDF (through the browser's print dialog: "Save as PDF"), as a Word document
 * (`.doc`, HTML that Word opens natively) or as a standalone HTML page.
 *
 *   export: { fileName: 'quotation-42', title: 'Quotation 42', stylesheets: ['/css/print.css'] }
 *
 * While merge-field preview is on, exports contain the preview values. Suggestions are exported as
 * they look (insertions underlined, deletions struck through) and comment highlights are dropped.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { escapeHtml, downloadFile } from '../shared/upcast';
import { renderMergeFields } from '../mergefields/mergefields';
import { hasEquations, replaceEquationsWithImages } from '../math/mathexport';
import type { Editor } from '../../core/editor';

export interface ExportConfig {
  /** File name without extension. Default `document`. */
  fileName?: string;
  /** Document title (HTML `<title>` and Word properties). Default: the first heading or "Document". */
  title?: string;
  /** Extra stylesheet URLs for PDF and HTML exports. */
  stylesheets?: string[];
  /** Extra CSS appended to the built-in document styles. */
  css?: string;
}

export type ExportFormat = 'pdf' | 'word' | 'html';

/** Styles of exported documents: readable typography, tables, figures and the editor's extras. */
export const exportStyles = `
body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1f2328; margin: 0; }
.document { max-width: 780px; margin: 0 auto; padding: 32px 40px; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 0.5em; }
p { margin: 0 0 0.8em; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
th, td { border: 1px solid #bfc5cd; padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: #f2f4f7; }
figure { margin: 1em 0; }
figure.image { text-align: center; }
figure.image img, img { max-width: 100%; height: auto; }
figcaption { font-size: 0.9em; color: #57606a; text-align: center; padding-top: 4px; }
figure.table > figcaption { caption-side: top; text-align: left; font-weight: 600; color: #1f2328; padding: 0 0 4px; }
blockquote { margin: 1em 0; padding: 0 1em; border-left: 4px solid #d0d7de; color: #57606a; font-style: italic; }
pre { background: #f6f8fa; padding: 10px 12px; border-radius: 4px; white-space: pre-wrap; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 0.95em; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 1.5em 0; }
.text-tiny { font-size: 0.7em; } .text-small { font-size: 0.85em; } .text-big { font-size: 1.4em; } .text-huge { font-size: 1.8em; }
mark { background: #fff59d; }
nav.table-of-contents { margin: 1em 0 1.5em; padding: 0.6em 1em; border: 1px solid #d0d7de; border-radius: 4px; }
nav.table-of-contents ol { list-style: none; padding-left: 0; margin: 0.3em 0 0; }
nav.table-of-contents ol ol { padding-left: 1.2em; }
nav.table-of-contents a { color: inherit; text-decoration: none; }
sup.footnote-ref a { text-decoration: none; }
section.footnotes { margin-top: 2em; padding-top: 0.5em; border-top: 1px solid #d0d7de; font-size: 0.9em; }
section.footnotes ol { padding-left: 1.4em; }
ins.suggestion-insert { color: #1a7f37; text-decoration: underline; }
del.suggestion-delete { color: #cf222e; }
figure.sketch svg { max-width: 100%; height: auto; }
figure.diagram { text-align: center; }
figure.diagram > svg, figure.diagram > img { max-width: 100%; height: auto; }
`;

/** The document's HTML as exports show it: merge-field values, drawn diagrams, no comment highlights. */
function exportBody(editor: Editor): string {
  let body = editor.getData();
  const mergeFields = editor.plugins.has('MergeFields') ? (editor.plugins.get('MergeFields') as any) : null;
  if (mergeFields && mergeFields.isPreviewing && mergeFields.previewData) body = renderMergeFields(body, mergeFields.previewData);
  // Diagrams are stored as their source; exports show the drawing.
  if (editor.plugins.has('Diagrams')) body = (editor.plugins.get('Diagrams') as any).toStaticHtml(body);
  // Comment anchors are editor-only highlights.
  return body.replace(/<span class="comment-anchor" data-comment="[^"]*">([\s\S]*?)<\/span>/g, '$1');
}

/**
 * The document as a complete HTML page, with equations drawn as self-contained images (PNG for Word,
 * which does not show SVG reliably; SVG otherwise), so they look right without KaTeX or its fonts.
 */
export async function buildExportDocumentWithImages(editor: Editor, options: { forWord?: boolean; extraHead?: string } = {}): Promise<string> {
  let body = exportBody(editor);
  if (hasEquations(body)) body = await replaceEquationsWithImages(body, { format: options.forWord ? 'png' : 'svg' });
  return buildExportDocument(editor, { ...options, body });
}

/** The document as a complete HTML page (equations as the editor writes them; see `buildExportDocumentWithImages`). */
export function buildExportDocument(editor: Editor, options: { forWord?: boolean; extraHead?: string; body?: string } = {}): string {
  const config = (editor.config.get('export') as ExportConfig | undefined) || {};
  const body = options.body ?? exportBody(editor);
  const title = escapeHtml(config.title || firstHeading(body) || 'Document');
  const css = exportStyles + (config.css || '');
  if (options.forWord) {
    return (
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      `<head><meta charset="utf-8"><title>${title}</title>` +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      `<style>${css} @page { size: 21cm 29.7cm; margin: 2cm; } .document { max-width: none; padding: 0; }</style></head>` +
      `<body><div class="document">${body}</div></body></html>`
    );
  }
  const links = (config.stylesheets || []).map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style>${links}${options.extraHead || ''}</head><body><div class="document">${body}</div></body></html>`;
}

function firstHeading(html: string): string {
  const match = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/.exec(html);
  return match ? match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
}

export class ExportCommand extends Command {
  constructor(editor: Editor, private readonly _format: ExportFormat) {
    super(editor);
    this.affectsData = false;
  }

  public override refresh(): void {
    this.isEnabled = true;
  }

  /** Starts the export; resolves with the generated HTML once the file is offered or printed. */
  public override execute(): Promise<string> {
    return this._export();
  }

  private async _export(): Promise<string> {
    const editor = this.editor;
    const config = (editor.config.get('export') as ExportConfig | undefined) || {};
    const fileName = config.fileName || 'document';
    if (this._format === 'word') {
      const html = await buildExportDocumentWithImages(editor, { forWord: true });
      // A byte-order mark makes Word read the file as UTF-8.
      downloadFile('﻿' + html, `${fileName}.doc`, 'application/msword');
      return html;
    }
    if (this._format === 'html') {
      const html = await buildExportDocumentWithImages(editor);
      downloadFile(html, `${fileName}.html`, 'text/html');
      return html;
    }
    // PDF: print a copy of the document (with the page's stylesheets, e.g. KaTeX) from a hidden frame.
    const doc = editor.ui.element?.ownerDocument || document;
    const pageStyles = [...doc.querySelectorAll('link[rel="stylesheet"], style')]
      .filter(node => !(node as HTMLElement).closest('.ck-body-wrapper'))
      .map(node => node.outerHTML)
      .join('');
    const html = await buildExportDocumentWithImages(editor, { extraHead: `${pageStyles}<style>${exportStyles}${config.css || ''} @page { margin: 18mm; } .document { padding: 0; }</style>` });
    printHtml(doc, html);
    return html;
  }
}

function printHtml(doc: Document, html: string): void {
  const frame = doc.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  doc.body.appendChild(frame);
  const frameWindow = frame.contentWindow;
  if (!frameWindow) {
    frame.remove();
    return;
  }
  frameWindow.document.open();
  frameWindow.document.write(html);
  frameWindow.document.close();
  const print = () => {
    try {
      frameWindow.focus();
      frameWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 1000);
    }
  };
  // Wait for stylesheets and images so the printout is complete.
  if (frameWindow.document.readyState === 'complete') setTimeout(print, 250);
  else frameWindow.addEventListener('load', () => setTimeout(print, 100), { once: true });
}

export class ExportDocument extends Plugin {
  public static override get pluginName(): string {
    return 'ExportDocument';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const buttons: Array<[string, ExportFormat, string, string]> = [
      ['exportPdf', 'pdf', t('Export to PDF'), icons.exportPdf],
      ['exportWord', 'word', t('Export to Word'), icons.exportWord],
      ['exportHtml', 'html', t('Export to HTML'), icons.exportHtml]
    ];
    for (const [name, format, label, icon] of buttons) {
      editor.commands.add(name, new ExportCommand(editor, format));
      editor.ui.componentFactory.add(name, locale => {
        const button = new ButtonView(locale);
        button.set({ label, icon, tooltip: true });
        this.listenTo(button, 'execute', () => editor.execute(name));
        return button;
      });
    }
  }
}
