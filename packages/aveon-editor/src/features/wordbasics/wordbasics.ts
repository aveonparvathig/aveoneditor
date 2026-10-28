/**
 * Everyday word-processor features: clipboard buttons, Format Painter, Change Case, grow/shrink
 * font, a heading style gallery and a full-screen writing mode.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { View } from '../../ui/view';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { DataTransfer } from '../../engine/view/observer/datatransfer';
import { normalizeFontSizeOptions } from '../font/font';
import type { Editor } from '../../core/editor';
import type { Locale } from '../../utils/locale';
import { FontDialog } from './fontdialog';

/* ------------------------------------------------------------------------------------------ */
/* Clipboard buttons                                                                           */
/* ------------------------------------------------------------------------------------------ */

/** Cut or copy through the browser, so the editor's own clipboard pipeline produces the data. */
export class ClipboardActionCommand extends Command {
  constructor(editor: Editor, private readonly _action: 'cut' | 'copy') {
    super(editor);
    this.affectsData = _action === 'cut';
  }

  public override refresh(): void {
    this.isEnabled = !this.editor.model.document.selection.isCollapsed;
  }

  public override execute(): void {
    this.editor.editing.view.focus();
    const doc = this.editor.ui.element?.ownerDocument || document;
    if (!doc.execCommand(this._action)) this._fail();
  }

  private _fail(): void {
    const key = this._action === 'cut' ? 'Ctrl+X' : 'Ctrl+C';
    warn(this.editor, this.editor.t(`Your browser blocks this button. Use ${key} instead.`));
  }
}

/** Reads the system clipboard (HTML when available) and inserts it like a regular paste. */
export class PasteCommand extends Command {
  public override refresh(): void {
    this.isEnabled = typeof navigator !== 'undefined' && !!navigator.clipboard;
  }

  public override async execute(): Promise<void> {
    const editor = this.editor;
    let html = '';
    let text = '';
    try {
      if (typeof navigator.clipboard.read === 'function') {
        for (const item of await navigator.clipboard.read()) {
          if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } else {
        text = await navigator.clipboard.readText();
      }
    } catch {
      warn(editor, editor.t('Your browser blocks pasting from the toolbar. Use Ctrl+V instead.'));
      return;
    }
    if (!html && !text) return;
    const native = new globalThis.DataTransfer();
    if (html) native.setData('text/html', html);
    if (text) native.setData('text/plain', text);
    editor.editing.view.focus();
    editor.editing.view.document.fire('clipboardInput', { dataTransfer: new DataTransfer(native), method: 'paste', targetRanges: null });
  }
}

function warn(editor: Editor, message: string): void {
  if (editor.plugins.has('Notification')) (editor.plugins.get('Notification') as any).showWarning(message, { namespace: 'clipboard' });
  else console.warn(message);
}

/* ------------------------------------------------------------------------------------------ */
/* Format Painter                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * First use copies the formatting at the selection; the next selection made with the mouse (or the
 * next use of the command) receives it. `value` is true while formatting is held.
 */
export class FormatPainterCommand extends Command {
  private _attributes: Map<string, unknown> | null = null;

  constructor(editor: Editor) {
    super(editor);
    this.affectsData = true;
  }

  public override refresh(): void {
    this.isEnabled = true;
    this.value = !!this._attributes;
  }

  public override execute(): void {
    if (this._attributes) {
      // A second click applies to a keyboard selection, otherwise it cancels.
      if (!this.editor.model.document.selection.isCollapsed) this.apply();
      else this.cancel();
      return;
    }
    const model = this.editor.model;
    this._attributes = new Map([...model.document.selection.getAttributes()].filter(([key]) => isFormatting(this.editor, key)));
    this.refresh();
  }

  public cancel(): void {
    this._attributes = null;
    this.refresh();
  }

  /** Paints the held formatting onto the current selection and releases it. */
  public apply(): void {
    const attributes = this._attributes;
    if (!attributes) return;
    const model = this.editor.model;
    const selection = model.document.selection;
    if (selection.isCollapsed) return;
    model.change(writer => {
      // Collect first: changing attributes splits and merges text nodes under the iterator.
      const removals: Array<{ parent: any; start: number; end: number; keys: string[] }> = [];
      for (const range of selection.getRanges()) {
        for (const item of range.getItems()) {
          if (!(item as any).is('$textProxy') && !(item as any).is('$text')) continue;
          const node = item as any;
          const keys = [...node.getAttributes()].map(([key]: [string]) => key).filter((key: string) => isFormatting(this.editor, key) && !attributes.has(key));
          if (keys.length) removals.push({ parent: node.parent, start: node.startOffset, end: node.startOffset + node.offsetSize, keys });
        }
      }
      for (const { parent, start, end, keys } of removals) {
        const range = writer.createRange(writer.createPositionAt(parent, start), writer.createPositionAt(parent, end));
        for (const key of keys) writer.removeAttribute(key, range);
      }
      for (const [key, value] of attributes) {
        for (const range of model.schema.getValidRanges(selection.getRanges(), key)) writer.setAttribute(key, value, range);
      }
    });
    this.cancel();
  }
}

function isFormatting(editor: Editor, key: string): boolean {
  const properties = editor.model.schema.getAttributeProperties(key) as { isFormatting?: boolean } | undefined;
  return !!(properties && properties.isFormatting);
}

/* ------------------------------------------------------------------------------------------ */
/* Change Case                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export type CaseMode = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle';

/** Changes the letter case of the selected text, keeping its formatting and the selection. */
export class ChangeCaseCommand extends Command {
  public override refresh(): void {
    const selection = this.editor.model.document.selection;
    this.isEnabled = !selection.isCollapsed;
  }

  public override execute(options: { value?: CaseMode } = {}): void {
    const mode = options.value || 'upper';
    const model = this.editor.model;
    const selection = model.document.selection;
    const backward = selection.isBackward;
    const saved = [...selection.getRanges()].map(range => ({ root: range.root as any, start: range.start.path, end: range.end.path }));
    model.change(writer => {
      for (const range of [...selection.getRanges()].reverse()) {
        // Text is converted per block so sentence and word boundaries stay correct.
        // Offsets are recorded up front: re-inserted text merges with its neighbours, which would
        // invalidate references to the original text nodes.
        type Run = { parent: any; start: number; data: string; attributes: Record<string, unknown> };
        const byParent = new Map<unknown, Run[]>();
        for (const item of range.getItems()) {
          if (!(item as any).is('$textProxy') && !(item as any).is('$text')) continue;
          const node = item as any;
          if (!byParent.has(node.parent)) byParent.set(node.parent, []);
          byParent.get(node.parent)!.push({ parent: node.parent, start: node.startOffset, data: node.data, attributes: Object.fromEntries(node.getAttributes()) });
        }
        for (const runs of [...byParent.values()].reverse()) {
          const text = runs.map(run => run.data).join('');
          const converted = convertCase(text, mode);
          let offset = text.length;
          for (const run of runs.slice().reverse()) {
            offset -= run.data.length;
            const next = converted.slice(offset, offset + run.data.length);
            if (next === run.data) continue;
            const start = writer.createPositionAt(run.parent, run.start);
            writer.remove(writer.createRange(start, writer.createPositionAt(run.parent, run.start + run.data.length)));
            writer.insertText(next, run.attributes, writer.createPositionAt(run.parent, run.start));
          }
        }
      }
      writer.setSelection(
        saved.map(s => writer.createRange(writer.createPositionFromPath(s.root, s.start), writer.createPositionFromPath(s.root, s.end))),
        { backward }
      );
    });
  }
}

/** Case conversion that never changes the text length (so the selection can be kept exactly). */
export function convertCase(text: string, mode: CaseMode, atSentenceStart = true): string {
  const upper = (ch: string) => (ch.toUpperCase().length === 1 ? ch.toUpperCase() : ch);
  const lower = (ch: string) => (ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch);
  const chars = [...text];
  let startOfSentence = atSentenceStart;
  let startOfWord = true;
  return chars
    .map(ch => {
      const letter = /\p{L}/u.test(ch);
      let out = ch;
      if (mode === 'upper') out = upper(ch);
      else if (mode === 'lower') out = lower(ch);
      else if (mode === 'toggle') out = ch === upper(ch) ? lower(ch) : upper(ch);
      else if (mode === 'title') out = letter && startOfWord ? upper(ch) : lower(ch);
      else if (mode === 'sentence') out = letter && startOfSentence ? upper(ch) : lower(ch);
      if (letter) {
        startOfSentence = false;
        startOfWord = false;
      } else if (/[.!?]/.test(ch)) {
        startOfSentence = true;
      } else if (/\s/.test(ch)) {
        startOfWord = true;
      }
      return out;
    })
    .join('');
}

/* ------------------------------------------------------------------------------------------ */
/* Grow / shrink font                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Steps the font size through the configured size options. */
export class FontSizeStepCommand extends Command {
  constructor(editor: Editor, private readonly _step: 1 | -1) {
    super(editor);
  }

  private get _sizes(): Array<string | undefined> {
    const options = normalizeFontSizeOptions((this.editor.config.get('fontSize.options') as any[]) || []);
    return options.map(option => option.model as string | undefined);
  }

  public override refresh(): void {
    const fontSize = this.editor.commands.get('fontSize');
    const sizes = this._sizes;
    const index = this._currentIndex(sizes);
    this.isEnabled = !!fontSize && fontSize.isEnabled && index + this._step >= 0 && index + this._step < sizes.length;
  }

  public override execute(): void {
    const sizes = this._sizes;
    const next = sizes[this._currentIndex(sizes) + this._step];
    this.editor.execute('fontSize', { value: next });
  }

  private _currentIndex(sizes: Array<string | undefined>): number {
    const value = this.editor.commands.get('fontSize')?.value as string | undefined;
    const index = sizes.indexOf(value);
    if (index !== -1) return index;
    // An unlisted pixel size sits between the listed ones.
    const px = value ? parseFloat(value) : NaN;
    if (!Number.isNaN(px)) {
      const larger = sizes.findIndex(size => size && parseFloat(size) > px);
      return larger === -1 ? sizes.length - 1 : this._step > 0 ? larger - 1 : larger;
    }
    return Math.max(0, sizes.indexOf(undefined));
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Full screen                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Lets the editor fill the window for distraction-free writing. */
export class FullscreenCommand extends Command {
  constructor(editor: Editor) {
    super(editor);
    this.affectsData = false;
    this.value = false;
  }

  public override refresh(): void {
    this.isEnabled = !!this.editor.ui.element;
  }

  public override execute(options: { value?: boolean } = {}): void {
    const element = this.editor.ui.element;
    if (!element) return;
    const on = options.value ?? !this.value;
    element.classList.toggle('ck-editor_fullscreen', on);
    element.ownerDocument.documentElement.classList.toggle('ck-fullscreen-open', on);
    this.value = on;
    this.editor.ui.update();
    this.editor.editing.view.focus();
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Plugin                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export class WordBasics extends Plugin {
  public static override get pluginName(): string {
    return 'WordBasics';
  }

  public static override get requires() {
    return [FontDialog];
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.commands.add('cut', new ClipboardActionCommand(editor, 'cut'));
    editor.commands.add('copy', new ClipboardActionCommand(editor, 'copy'));
    editor.commands.add('paste', new PasteCommand(editor));
    editor.commands.add('formatPainter', new FormatPainterCommand(editor));
    editor.commands.add('changeCase', new ChangeCaseCommand(editor));
    editor.commands.add('fullscreen', new FullscreenCommand(editor));
    if (editor.commands.get('fontSize')) {
      editor.commands.add('fontSizeIncrease', new FontSizeStepCommand(editor, 1));
      editor.commands.add('fontSizeDecrease', new FontSizeStepCommand(editor, -1));
      editor.keystrokes.set('Ctrl+Shift+.', (data, cancel) => {
        editor.execute('fontSizeIncrease');
        cancel();
      });
      editor.keystrokes.set('Ctrl+Shift+,', (data, cancel) => {
        editor.execute('fontSizeDecrease');
        cancel();
      });
    }

    this._addButton('cut', t('Cut'), icons.cut, 'Ctrl+X');
    this._addButton('copy', t('Copy'), icons.copy, 'Ctrl+C');
    this._addButton('paste', t('Paste'), icons.paste, 'Ctrl+V');
    this._addButton('formatPainter', t('Format Painter'), icons.formatPainter, undefined, true);
    this._addButton('fontSizeIncrease', t('Grow Font'), icons.fontSizeIncrease, 'Ctrl+Shift+.');
    this._addButton('fontSizeDecrease', t('Shrink Font'), icons.fontSizeDecrease, 'Ctrl+Shift+,');
    this._addFullscreenButton();
    this._addChangeCaseDropdown();
    this._addStyleGallery();
    this._setUpFormatPainter();

    editor.keystrokes.set('Esc', (data, cancel) => {
      const painter = editor.commands.get('formatPainter') as FormatPainterCommand;
      if (painter.value) {
        painter.cancel();
        cancel();
      } else if (editor.commands.get('fullscreen')!.value) {
        editor.execute('fullscreen', { value: false });
        cancel();
      }
    }, { priority: 'low' });
  }

  public override destroy(): void {
    const element = this.editor.ui.element;
    if (element) element.ownerDocument.documentElement.classList.remove('ck-fullscreen-open');
    super.destroy();
  }

  private _addButton(name: string, label: string, icon: string, keystroke?: string, toggleable = false): void {
    const editor = this.editor;
    const command = editor.commands.get(name);
    if (!command) return;
    editor.ui.componentFactory.add(name, locale => {
      const view = new ButtonView(locale);
      view.set({ label, icon, keystroke, tooltip: true, isToggleable: toggleable });
      view.bind('isEnabled').to(command, 'isEnabled');
      if (toggleable) view.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      this.listenTo(view, 'execute', () => {
        void editor.execute(name);
        if (name !== 'paste') editor.editing.view.focus();
      });
      return view;
    });
  }

  private _addFullscreenButton(): void {
    const editor = this.editor;
    const t = editor.t;
    const command = editor.commands.get('fullscreen')!;
    editor.ui.componentFactory.add('fullscreen', locale => {
      const view = new ButtonView(locale);
      view.set({ tooltip: true, isToggleable: true });
      view.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      view.bind('label').to(command, 'value', (value: unknown) => (value ? t('Exit full screen') : t('Full screen')));
      view.bind('icon').to(command, 'value', (value: unknown) => (value ? icons.fullscreenExit : icons.fullscreen));
      this.listenTo(view, 'execute', () => editor.execute('fullscreen'));
      return view;
    });
  }

  private _addChangeCaseDropdown(): void {
    const editor = this.editor;
    const t = editor.t;
    const command = editor.commands.get('changeCase')!;
    const modes: Array<[CaseMode, string]> = [
      ['sentence', t('Sentence case.')],
      ['lower', t('lowercase')],
      ['upper', t('UPPERCASE')],
      ['title', t('Capitalize Each Word')],
      ['toggle', t('tOGGLE cASE')]
    ];
    editor.ui.componentFactory.add('changeCase', locale => {
      const dropdownView = createDropdown(locale);
      addListToDropdown(
        dropdownView,
        () => {
          const items = new Collection<ListDropdownItemDefinition>();
          for (const [mode, label] of modes) {
            const model = new Observable() as any;
            model.set({ commandParam: mode, label, withText: true, role: 'menuitem' });
            items.add({ type: 'button', model });
          }
          return items;
        },
        { role: 'menu', ariaLabel: t('Change Case') }
      );
      dropdownView.buttonView.set({ label: t('Change Case'), icon: icons.changeCase, tooltip: true });
      dropdownView.bind('isEnabled').to(command);
      this.listenTo(dropdownView, 'execute', (evt: any) => {
        editor.execute('changeCase', { value: evt.source.commandParam });
        editor.editing.view.focus();
      });
      return dropdownView;
    });
  }

  /** Word-like row of style previews (Normal, Heading 1…) instead of a dropdown. */
  private _addStyleGallery(): void {
    const editor = this.editor;
    const t = editor.t;
    const heading = editor.commands.get('heading');
    const paragraph = editor.commands.get('paragraph');
    if (!heading || !paragraph) return;
    const options = (editor.config.get('heading.options') as Array<{ model: string; title: string }>) || [];
    editor.ui.componentFactory.add('styleGallery', locale => new StyleGalleryView(locale, editor, options, t('Styles')));
  }

  private _setUpFormatPainter(): void {
    const editor = this.editor;
    const painter = editor.commands.get('formatPainter') as FormatPainterCommand;
    const onMouseUp = () => {
      if (!painter.value) return;
      // Let the selection settle after the mouse is released.
      setTimeout(() => {
        if (painter.value && !editor.model.document.selection.isCollapsed) painter.apply();
      }, 0);
    };
    const attach = () => {
      const editable = editor.ui.getEditableElement();
      if (!editable) return;
      editable.addEventListener('mouseup', onMouseUp);
      painter.on('change:value', () => editable.classList.toggle('ck-format-painter-active', !!painter.value));
    };
    if ((editor.ui as any).isReady) attach();
    else editor.ui.once('ready', attach);
  }
}

/** Buttons previewing each paragraph style; the active style is highlighted. */
class StyleGalleryView extends View {
  public readonly items = this.createCollection<ButtonView>();

  constructor(locale: Locale, editor: Editor, options: Array<{ model: string; title: string }>, label: string) {
    super(locale);
    const heading = editor.commands.get('heading')!;
    const paragraph = editor.commands.get('paragraph')!;
    for (const option of options) {
      const button = new ButtonView(locale);
      const isParagraph = option.model === 'paragraph';
      button.set({ label: isParagraph ? editor.t('Normal') : option.title, withText: true, tooltip: false, isToggleable: true, class: `ck-style-gallery__item ck-style-gallery__item_${option.model}` });
      if (isParagraph) {
        button.bind('isOn').to(paragraph, 'value', (value: unknown) => !!value);
        button.bind('isEnabled').to(paragraph, 'isEnabled');
      } else {
        button.bind('isOn').to(heading, 'value', (value: unknown) => value === option.model);
        button.bind('isEnabled').to(heading, 'isEnabled');
      }
      button.on('execute', () => {
        if (isParagraph) editor.execute('paragraph');
        else editor.execute('heading', { value: option.model });
        editor.editing.view.focus();
      });
      this.items.add(button);
    }
    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-style-gallery'], role: 'group', 'aria-label': label }, children: this.items });
  }

  public focus(): void {
    const active = [...this.items].find(item => item.isOn) || this.items.first;
    active?.focus();
  }
}
