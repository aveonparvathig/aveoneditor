/**
 * GitHub-style content: math syntax ($…$, $`…`$, $$…$$, ```math), diagrams (Mermaid, GeoJSON,
 * TopoJSON, STL) and Markdown in and out.
 */

import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../builds/presets';
import { buildExportDocument } from './export/export';
import { markdownToHtml, htmlToMarkdown, looksLikeMarkdown, type Markdown } from './markdown/markdown';
import { parseMapSource, topojsonToFeatures, project } from './diagrams/maps';
import { parseStl } from './diagrams/stl';
import { DIAGRAM_SAMPLES, renderDiagram } from './diagrams/diagrams';

const fakeMermaid = {
  initialize: () => undefined,
  render: async (id: string, source: string) => {
    if (source.includes('broken')) throw new Error('Parse error on line 1');
    return { svg: `<svg id="${id}" data-source="${source.length}"><text>diagram</text></svg>` };
  }
};
const diagrams = { mermaid: { loader: async () => fakeMermaid } };

async function createEditor(html: string, config: Record<string, unknown> = {}) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  return ClassicEditor.create(element, { ...classicDefaultConfig, plugins: classicPreset, diagrams, ...config });
}

function caretAtEnd(editor: ClassicEditor, blockIndex = 0): void {
  editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(blockIndex) as any, 'end'));
}

/** Types `text` one character at a time, like a user. */
function type(editor: ClassicEditor, text: string): void {
  for (const ch of text) editor.execute('insertText', { text: ch });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('math syntax while typing', () => {
  it('turns $…$ and $`…`$ into inline equations', async () => {
    const editor = await createEditor('<p>Area</p>');
    caretAtEnd(editor);
    type(editor, ' $\\pi r^2$ and $`a$b`$ done');
    const data = editor.getData();
    expect(data).toContain('<span class="math-tex"');
    expect(data).toContain('\\(\\pi r^2\\)');
    expect(data).toContain('\\(a$b\\)');
    expect(data).toContain(' done');
  });

  it('leaves prices and escaped dollars alone', async () => {
    const editor = await createEditor('<p>x</p>');
    caretAtEnd(editor);
    type(editor, ' costs $5 and $10, or $5-$10, or \\$x$');
    expect(editor.getData()).toBe('<p>x costs $5 and $10, or $5-$10, or \\$x$</p>');
  });

  it('turns a $$…$$ paragraph into a display equation, and undo brings the text back', async () => {
    const editor = await createEditor('<p></p>');
    caretAtEnd(editor);
    type(editor, '$$E=mc^2$$');
    expect(editor.getData()).toContain('\\[E=mc^2\\]');
    editor.execute('undo');
    expect(editor.getData()).toBe('<p>$$E=mc^2$$</p>');
  });

  it('can be turned off', async () => {
    const editor = await createEditor('<p></p>', { math: { dollarSyntax: false } });
    caretAtEnd(editor);
    type(editor, '$x^2$');
    expect(editor.getData()).toBe('<p>$x^2$</p>');
  });

  it('reads a ```math code block as a display equation', async () => {
    const editor = await createEditor('<pre><code class="language-math">\\sum_{k=1}^n k</code></pre>');
    expect(editor.getData()).toContain('\\[\\sum_{k=1}^n k\\]');
  });
});

describe('diagrams', () => {
  it('stores the source and reads GitHub code blocks and its own figures', async () => {
    const editor = await createEditor('<pre><code class="language-mermaid">graph TD;\n  A-->B;</code></pre><figure class="diagram" data-diagram="geojson"><pre><code class="language-geojson">{"type":"Point","coordinates":[0,0]}</code></pre></figure>');
    const data = editor.getData();
    expect(data).toContain('<figure class="diagram" data-diagram="mermaid"><pre><code class="language-mermaid">graph TD;\n  A--&gt;B;</code></pre></figure>');
    expect(data).toContain('data-diagram="geojson"');
    // Ordinary code blocks stay code blocks.
    editor.setData('<pre><code class="language-javascript">let a = 1;</code></pre>');
    expect(editor.getData()).toContain('language-javascript');
    expect(editor.getData()).not.toContain('diagram');
  });

  it('inserts and edits through the command, and exports the drawing', async () => {
    const editor = await createEditor('<p>x</p>');
    caretAtEnd(editor);
    await editor.execute('insertDiagram', { type: 'mermaid', source: 'graph LR; A-->B' });
    await settle();
    await settle();
    const widget = editor.ui.getEditableElement()!.querySelector('.ck-diagram svg');
    expect(widget?.getAttribute('data-source')).toBe('15');
    const exported = buildExportDocument(editor);
    expect(exported).toContain('<figure class="diagram" data-diagram="mermaid"><svg');

    await editor.execute('insertDiagram', { source: 'graph LR; A-->C' });
    expect(editor.getData()).toContain('A--&gt;C');
    expect(editor.getData().match(/data-diagram/g)).toHaveLength(1);
  });

  it('shows Mermaid errors instead of a drawing', async () => {
    const editor = await createEditor('<pre><code class="language-mermaid">broken</code></pre>');
    await settle();
    await settle();
    const error = editor.ui.getEditableElement()!.querySelector('.ck-diagram__error');
    expect(error?.textContent).toContain('Parse error on line 1');
  });

  it('exports maps as SVG even before they are drawn', async () => {
    const editor = await createEditor(`<pre><code class="language-geojson">${DIAGRAM_SAMPLES.geojson}</code></pre>`);
    const exported = buildExportDocument(editor);
    expect(exported).toMatch(/<figure class="diagram" data-diagram="geojson"><svg[^>]*role="img"/);
    expect(exported).toContain('<circle');
    expect(exported).toContain('<path');
  });

  it('draws maps with interactive controls and feature details', async () => {
    const container = document.createElement('div');
    await renderDiagram(container, { type: 'topojson', source: DIAGRAM_SAMPLES.topojson });
    expect(container.querySelectorAll('.ck-map__feature')).toHaveLength(2);
    expect(container.querySelector('.ck-map__controls')?.children).toHaveLength(3);
    await expect(renderDiagram(document.createElement('div'), { type: 'geojson', source: '{"type":"Nope"}' })).rejects.toThrow('Unknown geometry type');
  });

  it('keeps styles from simplestyle properties but nothing unsafe', () => {
    const features = parseMapSource('geojson', JSON.stringify({ type: 'Feature', properties: { name: '<b>x</b>', stroke: 'red;onload=alert(1)', fill: '#ff0000' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }));
    const container = document.createElement('div');
    return renderDiagram(container, { type: 'geojson', source: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: features[0].properties, geometry: features[0].geometry }] }) }).then(() => {
      const html = container.innerHTML;
      expect(html).toContain('fill="#ff0000"');
      expect(html).not.toContain('onload');
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });
  });
});

describe('map and model readers', () => {
  it('decodes quantised TopoJSON arcs, including reversed ones', () => {
    const features = topojsonToFeatures({
      type: 'Topology',
      transform: { scale: [1, 1], translate: [10, 20] },
      objects: { shapes: { type: 'GeometryCollection', geometries: [{ type: 'LineString', arcs: [0, ~1] }, { type: 'Point', coordinates: [1, 1] }] } },
      arcs: [[[0, 0], [1, 0]], [[2, 0], [-1, 0]]]
    });
    expect(features[0].geometry).toEqual({ type: 'LineString', coordinates: [[10, 20], [11, 20], [12, 20]] });
    expect(features[1].geometry).toEqual({ type: 'Point', coordinates: [11, 21] });
  });

  it('projects with Web Mercator', () => {
    expect(project([0, 0])).toEqual([128, 128]);
    expect(project([180, 0])[0]).toBe(256);
  });

  it('reads ASCII STL and rejects other text', () => {
    const mesh = parseStl(DIAGRAM_SAMPLES.stl);
    expect(mesh.name).toBe('pyramid');
    expect(mesh.count).toBe(4);
    expect(Math.hypot(mesh.normals[0], mesh.normals[1], mesh.normals[2])).toBeCloseTo(1);
    expect(() => parseStl('hello')).toThrow('must start with "solid"');
    expect(() => parseStl('solid empty\nendsolid')).toThrow('no facets');
  });
});

describe('Markdown', () => {
  const sample = [
    '# Report',
    '',
    'Some **bold**, *italic*, ~~gone~~ and `code` with a [link](https://example.com).',
    '',
    'Inline $\\sqrt{3x-1}$ and $`a$b`$; to split <span>$</span>100 we use $100/2$.',
    '',
    '$$',
    '\\left( \\sum_{k=1}^n a_k b_k \\right)^2',
    '$$',
    '',
    '- [x] Done',
    '- [ ] To do',
    '',
    '1. First',
    '2. Second',
    '',
    '> Quoted',
    '',
    '| Item | Qty |',
    '| --- | --- |',
    '| Pens | 3 |',
    '',
    '```mermaid',
    'graph TD;',
    '    A-->B;',
    '```',
    '',
    '```math',
    'E=mc^2',
    '```',
    '',
    '```js',
    'let a = 1;',
    '```'
  ].join('\n');

  it('converts GitHub Markdown to editor content', async () => {
    const editor = await createEditor('<p></p>');
    (editor.plugins.get('Markdown') as Markdown).setMarkdown(sample);
    const data = editor.getData();
    // `#` maps to the editor's first heading level.
    expect(data).toContain('<h2>Report</h2>');
    expect(data).toContain('<strong>bold</strong>');
    expect(data).toContain('<s>gone</s>');
    expect(data).toContain('\\(\\sqrt{3x-1}\\)');
    expect(data).toContain('\\(a$b\\)');
    expect(data).toContain('to split $100 we use');
    expect(data).toContain('\\(100/2\\)');
    expect(data).toContain('\\[\\left( \\sum_{k=1}^n a_k b_k \\right)^2\\]');
    expect(data).toContain('\\[E=mc^2\\]');
    expect(data).toContain('todo-list');
    expect(data).toContain('checked');
    expect(data).toContain('<ol>');
    expect(data).toContain('<blockquote>');
    expect(data).toContain('<table>');
    expect(data).toContain('data-diagram="mermaid"');
    expect(data).toContain('language-javascript');
  });

  it('writes editor content back as Markdown that converts to the same content', async () => {
    const editor = await createEditor('<p></p>');
    const plugin = editor.plugins.get('Markdown') as Markdown;
    plugin.setMarkdown(sample);
    const first = editor.getData();
    const markdown = plugin.getMarkdown();
    expect(markdown).toContain('**bold**');
    expect(markdown).toContain('$\\sqrt{3x-1}$');
    expect(markdown).toContain('$`a$b`$');
    expect(markdown).toContain('<span>$</span>100');
    expect(markdown).toContain('$$\nE=mc^2\n$$');
    expect(markdown).toContain('- [x] Done');
    expect(markdown).toContain('```mermaid\ngraph TD;\n    A-->B;\n```');
    expect(markdown).toContain('| Pens | 3 |');
    plugin.setMarkdown(markdown);
    expect(editor.getData()).toBe(first);
  });

  it('escapes text that would otherwise read as Markdown', () => {
    const markdown = htmlToMarkdown('<p>1. not a list *really* # no</p><p># not a heading</p><p>costs $5</p>');
    expect(markdown).toBe('1\\. not a list \\*really\\* # no\n\n\\# not a heading\n\ncosts $5\n');
    expect(markdownToHtml(markdown)).toBe('<p>1. not a list *really* # no</p>\n<p># not a heading</p>\n<p>costs $5</p>\n');
  });

  it('recognises pasted Markdown but not ordinary text', () => {
    expect(looksLikeMarkdown('## Title\ntext')).toBe(true);
    expect(looksLikeMarkdown('```mermaid\ngraph TD\n```')).toBe(true);
    expect(looksLikeMarkdown('- one\n- two')).toBe(true);
    expect(looksLikeMarkdown('see $\\alpha$ here')).toBe(true);
    expect(looksLikeMarkdown('Dear John, the price is $5 and $10.')).toBe(false);
    expect(looksLikeMarkdown('Just a sentence.\nAnd another.')).toBe(false);
  });

  it('converts Markdown pasted as plain text', async () => {
    const editor = await createEditor('<p>x</p><p></p>');
    caretAtEnd(editor, 1);
    const data = new Map([['text/plain', '## Pasted\n\n- a\n- b']]);
    editor.editing.view.document.fire('clipboardInput', {
      dataTransfer: { getData: (key: string) => data.get(key) || '', types: [...data.keys()], files: [] },
      method: 'paste'
    } as any);
    const html = editor.getData();
    expect(html).toContain('Pasted</h');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
  });

  it('exports a .md file through the command', async () => {
    const editor = await createEditor('<h2>T</h2><p>Hello <u>there</u></p>');
    expect(editor.execute('exportMarkdown')).toBe('## T\n\nHello <ins>there</ins>\n');
  });
});
