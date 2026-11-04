/**
 * Diagrams written as text, the way GitHub renders them:
 * - `mermaid`: flowcharts, sequence diagrams, Gantt and pie charts and more (Mermaid)
 * - `geojson` and `topojson`: maps
 * - `stl`: 3D models (ASCII STL)
 *
 * Stored as the source text, so documents stay small, safe and editable, in the form GitHub and
 * Markdown tools use for fenced code blocks:
 *
 *   <figure class="diagram" data-diagram="mermaid"><pre><code class="language-mermaid">graph TD; A-->B</code></pre></figure>
 *
 * `<pre><code class="language-mermaid">` (and the other types) is read as a diagram too. Double-click
 * a diagram to edit it. Exports (PDF, Word, HTML) contain the drawn picture.
 *
 *   diagrams: {
 *     types: ['mermaid', 'geojson', 'topojson', 'stl'],
 *     mermaid: { theme: 'neutral' },
 *     map: { tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' }
 *   }
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { applyTheme } from '../../ui/theme';
import { Widget } from '../widget/widget';
import { toWidget } from '../widget/utils';
import { upcastAtomic, collectViewText, escapeHtml } from '../shared/upcast';
import { editOnDoubleClick } from '../references/references';
import { renderMermaid, type MermaidConfig } from './mermaid';
import { parseMapSource, mountMap, renderMapSvg, fitView, type MapOptions } from './maps';
import { parseStl, mountStl } from './stl';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

export type DiagramType = 'mermaid' | 'geojson' | 'topojson' | 'stl';

export const DIAGRAM_TYPES: DiagramType[] = ['mermaid', 'geojson', 'topojson', 'stl'];

export interface DiagramsConfig {
  /** Diagram types offered and recognised. Default: all four. */
  types?: DiagramType[];
  mermaid?: MermaidConfig;
  map?: MapOptions;
  /** Longest accepted source, in characters. Default 1,000,000. */
  maxSourceLength?: number;
}

export interface DiagramValue {
  type: DiagramType;
  source: string;
}

const MODEL = 'diagram';

const TYPE_LABELS: Record<DiagramType, string> = {
  mermaid: 'Mermaid diagram',
  geojson: 'Map (GeoJSON)',
  topojson: 'Map (TopoJSON)',
  stl: '3D model (STL)'
};

/** Starting points offered in the dialog. */
export const DIAGRAM_SAMPLES: Record<DiagramType, string> = {
  mermaid: ['flowchart TD', '    A[Order received] --> B{In stock?}', '    B -->|Yes| C[Ship it]', '    B -->|No| D[Order from supplier]', '    D --> C'].join('\n'),
  geojson: JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'Head office' }, geometry: { type: 'Point', coordinates: [-0.1276, 51.5072] } },
        {
          type: 'Feature',
          properties: { name: 'Delivery area', fill: '#1a7f37' },
          geometry: { type: 'Polygon', coordinates: [[[-0.35, 51.4], [0.1, 51.38], [0.15, 51.62], [-0.3, 51.65], [-0.35, 51.4]]] }
        }
      ]
    },
    null,
    2
  ),
  topojson: JSON.stringify(
    {
      type: 'Topology',
      transform: { scale: [0.001, 0.001], translate: [-0.35, 51.38] },
      objects: {
        area: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { name: 'Delivery area' } }, { type: 'Point', coordinates: [222, 127], properties: { name: 'Head office' } }] }
      },
      arcs: [[[0, 20], [450, -20], [50, 240], [-450, 30], [-50, -250]]]
    },
    null,
    2
  ),
  stl: [
    'solid pyramid',
    ...[
      [[0, 0, 0], [10, 0, 0], [5, 8.66, 0]],
      [[0, 0, 0], [5, 2.89, 8.16], [10, 0, 0]],
      [[10, 0, 0], [5, 2.89, 8.16], [5, 8.66, 0]],
      [[5, 8.66, 0], [5, 2.89, 8.16], [0, 0, 0]]
    ].map(corners => ['  facet normal 0 0 0', '    outer loop', ...corners.map(c => `      vertex ${c.join(' ')}`), '    endloop', '  endfacet'].join('\n')),
    'endsolid pyramid'
  ].join('\n')
};

function readValue(element: ModelElement): DiagramValue {
  const type = String(element.getAttribute('diagramType') || 'mermaid') as DiagramType;
  return { type: DIAGRAM_TYPES.includes(type) ? type : 'mermaid', source: String(element.getAttribute('diagramSource') || '') };
}

/** The diagram type of a `<pre><code class="language-…">` block, or `null`. */
function codeBlockType(pre: ViewElement, types: DiagramType[]): DiagramType | null {
  const children = [...pre.getChildren()].filter((child: any) => !(child.is('$text') && !child.data.trim()));
  const code = children.length === 1 && (children[0] as any).is('element', 'code') ? (children[0] as ViewElement) : null;
  const classes = [...((code || pre).getClassNames() as Iterable<string>)];
  const lang = String(pre.getAttribute('lang') || '');
  for (const type of types) {
    if (classes.includes(`language-${type}`) || classes.includes(`lang-${type}`) || lang === type) return type;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Drawing                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Draws a diagram into `container` (interactive maps and models, Mermaid SVG). Resolves with a
 * function returning static HTML of the drawing for exports, or rejects with a readable error.
 */
export async function renderDiagram(container: HTMLElement, value: DiagramValue, config: DiagramsConfig = {}): Promise<() => string> {
  const { type, source } = value;
  if (!source.trim()) throw new Error('The diagram is empty.');
  if (type === 'mermaid') {
    const svg = await renderMermaid(source, config.mermaid);
    container.innerHTML = svg;
    container.classList.add('ck-mermaid');
    return () => svg;
  }
  if (type === 'geojson' || type === 'topojson') {
    const features = parseMapSource(type, source);
    const current = mountMap(container, features, config.map);
    return current;
  }
  const mesh = parseStl(source);
  const image = mountStl(container, mesh);
  return () => {
    const url = image();
    return url ? `<img src="${url}" alt="${escapeHtml(mesh.name ? `3D model: ${mesh.name}` : '3D model')}">` : '';
  };
}

function showError(container: HTMLElement, error: unknown, t: (s: string) => string): void {
  container.innerHTML = '';
  const box = container.ownerDocument.createElement('div');
  box.className = 'ck-diagram__error';
  box.setAttribute('role', 'alert');
  box.textContent = `${t('This diagram cannot be drawn')}: ${String((error as Error)?.message || error).split('\n')[0]}`;
  container.append(box);
}

/* ------------------------------------------------------------------------------------------ */
/* Dialog                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Opens the diagram editor; resolves with the diagram, or `null` when cancelled. */
export function openDiagramDialog(editor: Editor, initial?: DiagramValue): Promise<DiagramValue | null> {
  const t = editor.t;
  const doc = editor.ui.element?.ownerDocument || document;
  const config = (editor.config.get('diagrams') as DiagramsConfig | undefined) || {};
  const types = (config.types || DIAGRAM_TYPES).filter(type => DIAGRAM_TYPES.includes(type));
  return new Promise(resolve => {
    let type: DiagramType = initial?.type || types[0] || 'mermaid';

    const overlay = doc.createElement('div');
    overlay.className = 'ck ck-dialog-overlay ck-reset_all-excluded';
    applyTheme(editor, overlay);
    const dialog = doc.createElement('div');
    dialog.className = 'ck-dialog ck-dialog_diagram';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', t('Diagram'));

    const title = doc.createElement('h2');
    title.className = 'ck-dialog__title';
    title.textContent = initial ? t('Edit diagram') : t('Insert diagram');

    const typeLabel = doc.createElement('label');
    typeLabel.className = 'ck-diagram__type';
    typeLabel.textContent = t('Type') + ' ';
    const select = doc.createElement('select');
    for (const value of types) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = t(TYPE_LABELS[value]);
      select.append(option);
    }
    select.value = type;
    typeLabel.append(select);

    const body = doc.createElement('div');
    body.className = 'ck-diagram__body';
    const textarea = doc.createElement('textarea');
    textarea.className = 'ck-diagram__source';
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', t('Diagram source'));
    textarea.value = initial?.source ?? DIAGRAM_SAMPLES[type];
    const preview = doc.createElement('div');
    preview.className = 'ck-diagram__preview ck-diagram__view';
    preview.setAttribute('aria-live', 'polite');
    body.append(textarea, preview);

    const actions = doc.createElement('div');
    actions.className = 'ck-dialog__actions';
    const action = (label: string, onClick: () => void) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ck-dialog__button';
      button.textContent = label;
      button.addEventListener('click', onClick);
      return button;
    };
    const close = (result: DiagramValue | null) => {
      clearTimeout(timer);
      overlay.remove();
      editor.editing.view.focus();
      resolve(result);
    };
    const cancel = action(t('Cancel'), () => close(null));
    const save = action(initial ? t('Save') : t('Insert'), () => {
      const source = textarea.value.replace(/\s+$/, '');
      close(source.trim() ? { type, source } : null);
    });
    save.classList.add('ck-dialog__button_primary');
    actions.append(cancel, save);

    dialog.append(title, typeLabel, body, actions);
    overlay.append(dialog);
    doc.body.appendChild(overlay);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let drawn = 0;
    const draw = () => {
      const run = ++drawn;
      const source = textarea.value;
      const target = doc.createElement('div');
      renderDiagram(target, { type, source }, config).then(
        () => {
          if (run !== drawn) return;
          preview.replaceChildren(target);
        },
        error => {
          if (run !== drawn) return;
          showError(preview, error, t);
        }
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 350);
    };
    textarea.addEventListener('input', schedule);
    select.addEventListener('change', () => {
      const previous = type;
      type = select.value as DiagramType;
      // Swap the sample when the text is still the previous sample (or empty).
      if (!textarea.value.trim() || textarea.value === DIAGRAM_SAMPLES[previous]) textarea.value = DIAGRAM_SAMPLES[type];
      draw();
    });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') close(null);
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        save.click();
      } else if (event.key === 'Tab' && event.target === textarea && !event.shiftKey) {
        // Tab indents inside the source (Mermaid uses indentation); Esc then Tab leaves the box.
        event.preventDefault();
        const start = textarea.selectionStart;
        textarea.setRangeText('    ', start, textarea.selectionEnd, 'end');
        schedule();
      }
    });
    draw();
    textarea.focus();
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Command and plugin                                                                          */
/* ------------------------------------------------------------------------------------------ */

export class InsertDiagramCommand extends Command {
  declare public value: DiagramValue | null;

  public override refresh(): void {
    const model = this.editor.model;
    const selected = model.document.selection.getSelectedElement();
    this.value = selected && selected.name === MODEL ? readValue(selected) : null;
    this.isEnabled = model.schema.findAllowedParent(model.document.selection.getFirstPosition()!, MODEL) !== null;
  }

  /** Inserts (or updates the selected) diagram; without `source` the diagram editor opens. */
  public override async execute(options: { type?: DiagramType; source?: string } = {}): Promise<void> {
    const editor = this.editor;
    const selected = editor.model.document.selection.getSelectedElement();
    const existing = selected && selected.name === MODEL ? selected : null;
    const value =
      options.source !== undefined
        ? { type: options.type || (existing ? readValue(existing).type : 'mermaid'), source: options.source }
        : await openDiagramDialog(editor, existing ? readValue(existing) : options.type ? { type: options.type, source: DIAGRAM_SAMPLES[options.type] } : undefined);
    if (!value || !DIAGRAM_TYPES.includes(value.type)) return;
    const max = ((editor.config.get('diagrams') as DiagramsConfig | undefined) || {}).maxSourceLength ?? 1_000_000;
    if (value.source.length > max) throw new Error(`diagram-too-large: the diagram source is longer than ${max} characters.`);
    editor.model.change(writer => {
      if (existing) {
        writer.setAttribute('diagramType', value.type, existing);
        writer.setAttribute('diagramSource', value.source, existing);
        return;
      }
      const element = writer.createElement(MODEL, { diagramType: value.type, diagramSource: value.source });
      editor.model.insertContent(element);
      writer.setSelection(element, 'on');
    });
  }
}

export class Diagrams extends Plugin {
  /** Static HTML of drawn diagrams, by `type + "\n" + source`, used by exports. */
  private readonly _drawings = new Map<string, () => string>();

  public static override get pluginName(): string {
    return 'Diagrams';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const config = (editor.config.get('diagrams') as DiagramsConfig | undefined) || {};
    const types = (config.types || DIAGRAM_TYPES).filter(type => DIAGRAM_TYPES.includes(type));
    const max = config.maxSourceLength ?? 1_000_000;
    editor.model.schema.register(MODEL, { inheritAllFrom: '$blockObject', allowAttributes: ['diagramType', 'diagramSource'] });

    const create = (type: DiagramType | null, view: ViewElement, writer: any) => {
      if (!type) return null;
      const source = collectViewText(view).replace(/\r\n?/g, '\n').replace(/\n$/, '');
      return source.length <= max ? writer.createElement(MODEL, { diagramType: type, diagramSource: source }) : null;
    };
    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on(
        'element:figure',
        upcastAtomic(
          view => view.hasClass('diagram'),
          (view, writer) => {
            const type = String(view.getAttribute('data-diagram') || '') as DiagramType;
            return create(types.includes(type) ? type : null, view, writer);
          }
        ),
        { priority: 'high' }
      );
      // GitHub and Markdown tools write diagrams as fenced code blocks.
      dispatcher.on(
        'element:pre',
        upcastAtomic(
          view => codeBlockType(view, types) !== null,
          (view, writer) => create(codeBlockType(view, types), view, writer)
        ),
        // Before the code block converter, which also runs at high priority.
        { priority: 'highest' }
      );
    });

    editor.conversion.for('dataDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => {
        const { type, source } = readValue(element);
        const figure = writer.createContainerElement('figure', { class: 'diagram', 'data-diagram': type });
        const pre = writer.createContainerElement('pre');
        const code = writer.createContainerElement('code', { class: `language-${type}` });
        writer.insert(writer.createPositionAt(code, 0), writer.createText(source));
        writer.insert(writer.createPositionAt(pre, 0), code);
        writer.insert(writer.createPositionAt(figure, 0), pre);
        return figure;
      }
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: MODEL,
      view: (element: ModelElement, { writer }: any) => {
        const value = readValue(element);
        const figure = writer.createContainerElement('figure', { class: `ck-diagram ck-diagram_${value.type}`, title: t('Double-click to edit') });
        const drawing = writer.createRawElement('div', { class: 'ck-diagram__view' }, (dom: HTMLElement) => this._draw(dom, value));
        writer.insert(writer.createPositionAt(figure, 0), drawing);
        return toWidget(figure, writer, { label: t(TYPE_LABELS[value.type]) });
      }
    });
    // A changed diagram is drawn again.
    editor.model.document.on('change:data', () => {
      for (const change of editor.model.document.differ.getChanges()) {
        if (change.type === 'attribute' && (change.attributeKey === 'diagramSource' || change.attributeKey === 'diagramType')) {
          const element = change.range.start.nodeAfter;
          if (element) editor.editing.reconvertItem(element as ModelElement);
        }
      }
    });

    editor.commands.add('insertDiagram', new InsertDiagramCommand(editor));
    editor.ui.componentFactory.add('insertDiagram', locale => {
      const command = editor.commands.get('insertDiagram')!;
      const button = new ButtonView(locale);
      button.set({ label: t('Diagram'), icon: icons.diagram, tooltip: true });
      button.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(button, 'execute', () => editor.execute('insertDiagram'));
      return button;
    });
    editOnDoubleClick(editor, [MODEL], 'insertDiagram');
  }

  private _draw(dom: HTMLElement, value: DiagramValue): void {
    const t = this.editor.t;
    const config = (this.editor.config.get('diagrams') as DiagramsConfig | undefined) || {};
    const key = `${value.type}\n${value.source}`;
    dom.textContent = t('Drawing…');
    renderDiagram(dom, value, config).then(
      picture => this._drawings.set(key, picture),
      error => showError(dom, error, t)
    );
  }

  /**
   * `html` (editor data) with each diagram replaced by its drawing, for exports. Diagrams that are not
   * drawn (yet) keep their source.
   */
  public toStaticHtml(html: string): string {
    const config = (this.editor.config.get('diagrams') as DiagramsConfig | undefined) || {};
    return html.replace(/<figure class="diagram" data-diagram="(\w+)"><pre><code class="language-\w+">([\s\S]*?)<\/code><\/pre><\/figure>/g, (whole, type: DiagramType, escaped: string) => {
      const source = unescapeHtml(escaped);
      let picture = '';
      try {
        const drawn = this._drawings.get(`${type}\n${source}`);
        if (drawn) picture = drawn();
        else if (type === 'geojson' || type === 'topojson') {
          const features = parseMapSource(type, source);
          picture = renderMapSvg(features, fitView(features, config.map?.maxZoom), config.map);
        }
      } catch {
        picture = '';
      }
      return picture ? `<figure class="diagram" data-diagram="${type}">${picture}</figure>` : whole;
    });
  }
}

function unescapeHtml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (_, name: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' })[name]!);
}
