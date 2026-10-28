/**
 * References: table of contents, footnotes and table captions (Word's References tab).
 *
 * - Table of contents: a block that lists the document's headings and stays up to date. Saved as
 *   `<nav class="table-of-contents">` with links; headings then get matching `id`s.
 * - Footnotes: numbered markers in the text; the notes are listed in a "Footnotes" section that is
 *   kept at the end of the document. Double-click a marker to edit its note.
 * - Table captions: `<figcaption>` for tables, set from the "Caption" button.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { Widget } from '../widget/widget';
import { toWidget } from '../widget/utils';
import { upcastAtomic, escapeHtml } from '../shared/upcast';
import { promptDialog } from '../shared/dialog';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';

const TOC = 'tableOfContents';
const FOOTNOTE = 'footnote';
const FOOTNOTES = 'footnotesSection';

/* ------------------------------------------------------------------------------------------ */
/* Shared helpers                                                                              */
/* ------------------------------------------------------------------------------------------ */

function modelText(element: ModelElement): string {
  let text = '';
  for (const child of element.getChildren()) {
    const node = child as any;
    if (node.is('$text')) text += node.data;
    else if (node.is('element') && !node.is('element', FOOTNOTE)) text += modelText(node);
  }
  return text.replace(/\s+/g, ' ').trim();
}

function* elementsNamed(editor: Editor, names: string[]): IterableIterator<ModelElement> {
  const root = editor.model.document.getRoot();
  if (!root) return;
  for (const item of editor.model.createRangeIn(root).getItems()) {
    if ((item as any).is('element') && names.includes((item as ModelElement).name)) yield item as ModelElement;
  }
}

/** Registry of live DOM previews, refreshed after every data change. */
class LiveRenders {
  private readonly _renders = new Map<HTMLElement, () => void>();

  public add(element: HTMLElement, render: () => void): void {
    this._renders.set(element, render);
    render();
  }

  public refresh(): void {
    for (const [element, render] of this._renders) {
      if (element.isConnected) render();
      else this._renders.delete(element);
    }
  }
}

/** Opens `command` when the user double-clicks a widget of one of the given types. */
export function editOnDoubleClick(editor: Editor, names: string[], command: string): void {
  const attach = () => {
    const editable = editor.ui.getEditableElement();
    if (!editable) return;
    editable.addEventListener('dblclick', () => {
      // The click has selected the widget by now.
      setTimeout(() => {
        const selected = editor.model.document.selection.getSelectedElement();
        if (selected && names.includes(selected.name)) editor.execute(command);
      }, 0);
    });
  };
  if ((editor.ui as any).isReady) attach();
  else editor.ui.once('ready', attach);
}

function addButton(editor: Editor, name: string, label: string, icon: string, command = name): void {
  editor.ui.componentFactory.add(name, locale => {
    const button = new ButtonView(locale);
    button.set({ label, icon, tooltip: true });
    const cmd = editor.commands.get(command);
    if (cmd) button.bind('isEnabled').to(cmd, 'isEnabled');
    button.on('execute', () => {
      editor.execute(command);
      editor.editing.view.focus();
    });
    return button;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Table of contents                                                                           */
/* ------------------------------------------------------------------------------------------ */

export interface TocEntry {
  element: ModelElement;
  level: number;
  text: string;
  id: string;
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section'
  );
}

/** Headings in document order with their level and a unique id. */
export function getTocEntries(editor: Editor): TocEntry[] {
  const options = ((editor.config.get('heading.options') as Array<{ model: string }>) || []).filter(option => option.model !== 'paragraph');
  const levels = new Map(options.map((option, index) => [option.model, index + 1]));
  const used = new Map<string, number>();
  const entries: TocEntry[] = [];
  for (const element of elementsNamed(editor, [...levels.keys()])) {
    const text = modelText(element);
    if (!text) continue;
    let id = slugify(text);
    const count = used.get(id) || 0;
    used.set(id, count + 1);
    if (count) id = `${id}-${count + 1}`;
    entries.push({ element, level: levels.get(element.name)!, text, id });
  }
  return entries;
}

/** Nested ordered lists for the entries. */
function tocListHtml(entries: TocEntry[], withLinks: boolean): string {
  if (!entries.length) return '';
  const minLevel = Math.min(...entries.map(entry => entry.level));
  let html = '';
  let depth = 0;
  for (const entry of entries) {
    const level = entry.level - minLevel + 1;
    if (level > depth) {
      while (depth < level) {
        html += '<ol>';
        depth++;
      }
    } else {
      html += '</li>';
      while (depth > level) {
        html += '</ol></li>';
        depth--;
      }
    }
    const text = escapeHtml(entry.text);
    html += withLinks ? `<li><a href="#${entry.id}">${text}</a>` : `<li><a data-heading-id="${entry.id}">${text}</a>`;
  }
  html += '</li>';
  while (depth > 1) {
    html += '</ol></li>';
    depth--;
  }
  return html + '</ol>';
}

export class InsertTableOfContentsCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    this.isEnabled = model.schema.findAllowedParent(model.document.selection.getFirstPosition()!, TOC) !== null;
  }

  public override execute(): void {
    const model = this.editor.model;
    const existing = [...elementsNamed(this.editor, [TOC])][0];
    model.change(writer => {
      if (existing) {
        writer.setSelection(existing, 'on');
        return;
      }
      const element = writer.createElement(TOC);
      model.insertContent(element);
      writer.setSelection(element, 'on');
    });
  }
}

export class TableOfContents extends Plugin {
  private readonly _live = new LiveRenders();

  public static override get pluginName(): string {
    return 'TableOfContents';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.model.schema.register(TOC, { inheritAllFrom: '$blockObject' });

    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on('element:nav', upcastAtomic(view => view.hasClass('table-of-contents'), (view, writer) => writer.createElement(TOC)), { priority: 'high' });
    });
    editor.conversion.for('dataDowncast').elementToElement({
      model: TOC,
      view: (element: ModelElement, { writer }: any) => {
        const entries = getTocEntries(editor);
        return writer.createRawElement('nav', { class: 'table-of-contents' }, (dom: HTMLElement) => {
          dom.innerHTML = `<p class="table-of-contents__title">${escapeHtml(t('Contents'))}</p>${tocListHtml(entries, true)}`;
        });
      }
    });
    // One scan per document version, not one per heading.
    let snapshot: { version: number; hasToc: boolean; entries: TocEntry[] } | null = null;
    const tocSnapshot = () => {
      const version = (editor.model.document as any).version as number;
      if (!snapshot || snapshot.version !== version) {
        snapshot = { version, hasToc: !elementsNamed(editor, [TOC]).next().done, entries: getTocEntries(editor) };
      }
      return snapshot;
    };
    // Headings get the ids the contents links point to (only in documents with a table of contents).
    editor.conversion.for('dataDowncast').add(dispatcher => {
      dispatcher.on(
        'insert',
        (evt: any, data: any, conversionApi: any) => {
          const item = data.item;
          if (!item.is || !item.is('element') || !item.name.startsWith('heading')) return;
          const { hasToc, entries } = tocSnapshot();
          if (!hasToc) return;
          const entry = entries.find(candidate => candidate.element === item);
          const viewElement = conversionApi.mapper.toViewElement(item);
          if (entry && viewElement) conversionApi.writer.setAttribute('id', entry.id, viewElement);
        },
        { priority: 'low' }
      );
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: TOC,
      view: (element: ModelElement, { writer }: any) => {
        const container = writer.createContainerElement('div', { class: 'ck-table-of-contents' });
        const list = writer.createRawElement('div', { class: 'ck-table-of-contents__list' }, (dom: HTMLElement) => {
          this._live.add(dom, () => {
            const entries = getTocEntries(editor);
            dom.innerHTML = `<p class="ck-table-of-contents__title">${escapeHtml(t('Contents'))}</p>${
              entries.length ? tocListHtml(entries, false) : `<p class="ck-table-of-contents__empty">${escapeHtml(t('Add headings (Heading 1, 2, 3) to build the table of contents.'))}</p>`
            }`;
          });
          dom.addEventListener('mousedown', event => {
            const link = (event.target as HTMLElement).closest('a[data-heading-id]');
            if (!link) return;
            event.preventDefault();
            event.stopPropagation();
            const entry = getTocEntries(editor).find(candidate => candidate.id === link.getAttribute('data-heading-id'));
            if (!entry) return;
            editor.model.change(w => w.setSelection(entry.element, 0));
            editor.editing.view.focus();
            editor.editing.view.scrollToTheSelection?.();
          });
        });
        writer.insert(writer.createPositionAt(container, 0), list);
        return toWidget(container, writer, { label: t('Table of contents') });
      }
    });

    editor.model.document.on('change:data', () => this._live.refresh());
    editor.commands.add('insertTableOfContents', new InsertTableOfContentsCommand(editor));
    addButton(editor, 'tableOfContents', t('Table of contents'), icons.tableOfContents, 'insertTableOfContents');
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Footnotes                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function footnotesOf(editor: Editor): ModelElement[] {
  return [...elementsNamed(editor, [FOOTNOTE])];
}

export class InsertFootnoteCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    this.isEnabled = model.schema.findAllowedParent(model.document.selection.getFirstPosition()!, FOOTNOTE) !== null;
  }

  /** Inserts a footnote with `note`, or asks for the text when it is not given. */
  public override async execute(options: { note?: string } = {}): Promise<void> {
    const editor = this.editor;
    const note = options.note ?? (await promptDialog(editor, { title: editor.t('Insert footnote'), label: editor.t('Footnote text'), multiline: true, submitLabel: editor.t('Insert') }));
    if (!note) return;
    editor.model.change(writer => {
      const element = writer.createElement(FOOTNOTE, { note });
      editor.model.insertContent(element);
      writer.setSelection(element, 'after');
    });
  }
}

export class EditFootnoteCommand extends Command {
  public override refresh(): void {
    const selected = this.editor.model.document.selection.getSelectedElement();
    this.isEnabled = !!selected && selected.name === FOOTNOTE;
  }

  public override async execute(options: { note?: string } = {}): Promise<void> {
    const editor = this.editor;
    const element = editor.model.document.selection.getSelectedElement();
    if (!element || element.name !== FOOTNOTE) return;
    const note =
      options.note ??
      (await promptDialog(editor, { title: editor.t('Edit footnote'), label: editor.t('Footnote text'), value: String(element.getAttribute('note') || ''), multiline: true, removable: true }));
    if (note === null) return;
    editor.model.change(writer => {
      if (note === '') writer.remove(element);
      else writer.setAttribute('note', note, element);
    });
  }
}

export class Footnotes extends Plugin {
  private readonly _live = new LiveRenders();

  public static override get pluginName(): string {
    return 'Footnotes';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const schema = editor.model.schema;
    schema.register(FOOTNOTE, { allowWhere: '$text', isInline: true, isObject: true, allowAttributesOf: '$text', allowAttributes: ['note'] });
    schema.register(FOOTNOTES, { allowIn: '$root', isObject: true, isBlock: true, isSelectable: false });

    editor.conversion.for('upcast').add(dispatcher => {
      dispatcher.on(
        'element:sup',
        upcastAtomic(
          view => view.hasClass('footnote-ref') && view.hasAttribute('data-footnote'),
          (view, writer) => writer.createElement(FOOTNOTE, { note: String(view.getAttribute('data-footnote')) })
        ),
        { priority: 'high' }
      );
      // The list is regenerated from the markers, so its saved copy is skipped.
      dispatcher.on('element:section', upcastAtomic(view => view.hasClass('footnotes'), (view, writer) => writer.createElement(FOOTNOTES)), { priority: 'high' });
    });

    const numberOf = (element: ModelElement) => footnotesOf(editor).indexOf(element) + 1;
    editor.conversion.for('dataDowncast').elementToElement({
      model: FOOTNOTE,
      view: (element: ModelElement, { writer }: any) => {
        const n = numberOf(element);
        const sup = writer.createContainerElement('sup', { class: 'footnote-ref', 'data-footnote': String(element.getAttribute('note') || '') });
        const link = writer.createContainerElement('a', { href: `#fn-${n}`, id: `fnref-${n}` });
        writer.insert(writer.createPositionAt(link, 0), writer.createText(String(n)));
        writer.insert(writer.createPositionAt(sup, 0), link);
        return sup;
      }
    });
    editor.conversion.for('dataDowncast').elementToElement({
      model: FOOTNOTES,
      view: (element: ModelElement, { writer }: any) => {
        const notes = footnotesOf(editor).map((footnote, index) => `<li id="fn-${index + 1}">${escapeHtml(String(footnote.getAttribute('note') || ''))} <a href="#fnref-${index + 1}" aria-label="${escapeHtml(t('Back to text'))}">↩</a></li>`);
        return writer.createRawElement('section', { class: 'footnotes' }, (dom: HTMLElement) => {
          dom.innerHTML = `<ol>${notes.join('')}</ol>`;
        });
      }
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: FOOTNOTE,
      view: (element: ModelElement, { writer }: any) => {
        const container = writer.createContainerElement('sup', { class: 'ck-footnote', title: String(element.getAttribute('note') || '') });
        const number = writer.createRawElement('span', { class: 'ck-footnote__number' }, (dom: HTMLElement) => {
          this._live.add(dom, () => {
            dom.textContent = String(numberOf(element) || '');
          });
        });
        writer.insert(writer.createPositionAt(container, 0), number);
        return toWidget(container, writer, { label: t('Footnote') });
      }
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: FOOTNOTES,
      view: (element: ModelElement, { writer }: any) => {
        const container = writer.createContainerElement('section', { class: 'ck-footnotes' });
        const list = writer.createRawElement('div', { class: 'ck-footnotes__list' }, (dom: HTMLElement) => {
          this._live.add(dom, () => {
            const items = footnotesOf(editor).map(footnote => `<li>${escapeHtml(String(footnote.getAttribute('note') || ''))}</li>`);
            dom.innerHTML = `<p class="ck-footnotes__title">${escapeHtml(t('Footnotes'))}</p><ol>${items.join('')}</ol>`;
          });
        });
        writer.insert(writer.createPositionAt(container, 0), list);
        return toWidget(container, writer, { label: t('Footnotes') });
      }
    });

    // Keep exactly one footnotes section, at the end, while there are footnotes.
    editor.model.document.registerPostFixer(writer => {
      // Typing and formatting cannot add, remove or move footnotes or blocks.
      const structural = editor.model.document.differ.getChanges().some(change => change.type === 'refresh' || ((change.type === 'insert' || change.type === 'remove') && change.name !== '$text'));
      const root = editor.model.document.getRoot();
      if (!structural || !root) return false;
      const sections = [...root.getChildren()].filter(child => (child as ModelElement).name === FOOTNOTES) as ModelElement[];
      const hasNotes = footnotesOf(editor).length > 0;
      let changed = false;
      if (!hasNotes) {
        for (const section of sections) writer.remove(section);
        return sections.length > 0;
      }
      for (const extra of sections.slice(1)) {
        writer.remove(extra);
        changed = true;
      }
      const section = sections[0];
      if (!section) {
        writer.insert(writer.createElement(FOOTNOTES), root, 'end');
        changed = true;
      } else if (root.getChild(root.childCount - 1) !== section) {
        writer.move(writer.createRangeOn(section), root, 'end');
        changed = true;
      }
      return changed;
    });

    editor.model.document.on('change:data', () => this._live.refresh());
    editor.commands.add('insertFootnote', new InsertFootnoteCommand(editor));
    editor.commands.add('editFootnote', new EditFootnoteCommand(editor));
    addButton(editor, 'insertFootnote', t('Insert footnote'), icons.footnote);
    editOnDoubleClick(editor, [FOOTNOTE], 'editFootnote');
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Table caption                                                                               */
/* ------------------------------------------------------------------------------------------ */

function selectedTable(editor: Editor): ModelElement | null {
  const selection = editor.model.document.selection;
  const selected = selection.getSelectedElement();
  if (selected && selected.name === 'table') return selected;
  const position = selection.getFirstPosition();
  let node: any = position && position.parent;
  while (node && !(node.is && node.is('element', 'table'))) node = node.parent;
  return node || null;
}

export class TableCaptionCommand extends Command {
  public override refresh(): void {
    const table = selectedTable(this.editor);
    this.isEnabled = !!table;
    this.value = table ? String(table.getAttribute('caption') || '') || false : false;
  }

  /** Sets (or with `''` removes) the caption of the selected table; asks when no text is given. */
  public override async execute(options: { caption?: string } = {}): Promise<void> {
    const editor = this.editor;
    const table = selectedTable(editor);
    if (!table) return;
    const current = String(table.getAttribute('caption') || '');
    const caption =
      options.caption ??
      (await promptDialog(editor, { title: editor.t('Table caption'), label: editor.t('Caption'), value: current, placeholder: editor.t('Table 1: Price list'), removable: !!current }));
    if (caption === null) return;
    editor.model.change(writer => {
      if (caption) writer.setAttribute('caption', caption, table);
      else writer.removeAttribute('caption', table);
    });
  }
}

export class TableCaption extends Plugin {
  public static override get pluginName(): string {
    return 'TableCaption';
  }

  public override init(): void {
    const editor = this.editor;
    if (!editor.model.schema.isRegistered('table')) return;
    editor.commands.add('tableCaption', new TableCaptionCommand(editor));
    addButton(editor, 'tableCaption', editor.t('Table caption'), icons.caption);
  }
}

/** Table of contents, footnotes and table captions. */
export class References extends Plugin {
  public static override get pluginName(): string {
    return 'References';
  }

  public static override get requires() {
    return [TableOfContents, Footnotes, TableCaption];
  }
}
