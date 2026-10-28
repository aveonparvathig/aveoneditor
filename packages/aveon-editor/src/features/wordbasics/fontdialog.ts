/**
 * Font dialog (Word's Font group launcher): family, size, colours and effects with a live preview,
 * applied together as one undoable step.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { View } from '../../ui/view';
import { normalizeFontFamilyOptions, normalizeFontSizeOptions } from '../font/font';
import type { Editor } from '../../core/editor';
import type { Locale } from '../../utils/locale';

interface FontState {
  fontFamily?: string;
  fontSize?: string;
  fontColor?: string;
  fontBackgroundColor?: string;
  effects: Record<string, boolean>;
}

const EFFECTS: Array<[string, string]> = [
  ['bold', 'Bold'],
  ['italic', 'Italic'],
  ['underline', 'Underline'],
  ['strikethrough', 'Strikethrough'],
  ['superscript', 'Superscript'],
  ['subscript', 'Subscript']
];

/** Opens the Font dialog for the current selection. */
export class FontDialogCommand extends Command {
  constructor(editor: Editor, private readonly _open: () => void) {
    super(editor);
    this.affectsData = false;
  }

  public override refresh(): void {
    this.isEnabled = !this.editor.isReadOnly;
  }

  public override execute(): void {
    this._open();
  }
}

export class FontDialog extends Plugin {
  private _view: FontDialogView | null = null;

  public static override get pluginName(): string {
    return 'FontDialog';
  }

  public override init(): void {
    this.editor.commands.add('fontDialog', new FontDialogCommand(this.editor, () => this.open()));
  }

  public override destroy(): void {
    this.close();
    super.destroy();
  }

  public open(): void {
    const editor = this.editor;
    this.close();
    const view = new FontDialogView(editor.locale, editor, this._readState());
    view.on('submit', (evt, state: FontState) => {
      this._apply(state);
      this.close();
    });
    view.on('cancel', () => this.close());
    this._view = view;
    (editor.ui.view as any).body.add(view);
    view.focus();
  }

  public close(): void {
    if (!this._view) return;
    const view = this._view;
    this._view = null;
    (this.editor.ui.view as any).body.remove(view);
    view.destroy();
    this.editor.editing.view.focus();
  }

  private _readState(): FontState {
    const commands = this.editor.commands;
    const value = (name: string) => commands.get(name)?.value as string | undefined;
    const effects: Record<string, boolean> = {};
    for (const [name] of EFFECTS) if (commands.get(name)) effects[name] = !!commands.get(name)!.value;
    return { fontFamily: value('fontFamily'), fontSize: value('fontSize'), fontColor: value('fontColor'), fontBackgroundColor: value('fontBackgroundColor'), effects };
  }

  private _apply(next: FontState): void {
    const editor = this.editor;
    const current = this._readState();
    editor.model.change(() => {
      for (const key of ['fontFamily', 'fontSize', 'fontColor', 'fontBackgroundColor'] as const) {
        if (editor.commands.get(key) && next[key] !== current[key]) editor.execute(key, { value: next[key] });
      }
      for (const [name, on] of Object.entries(next.effects)) {
        if (current.effects[name] === on) continue;
        // Attribute commands toggle; `forceValue` sets the wanted state explicitly.
        editor.execute(name, { forceValue: on });
      }
    });
  }
}

/** Modal dialog; fires `submit` with the chosen state, or `cancel`. */
export class FontDialogView extends View {
  private readonly _state: FontState;
  private readonly _editor: Editor;
  private _firstField: HTMLElement | null = null;

  constructor(locale: Locale, editor: Editor, state: FontState) {
    super(locale);
    this._editor = editor;
    this._state = { ...state, effects: { ...state.effects } };
    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-dialog-overlay', 'ck-reset_all-excluded'] } });
  }

  public override render(): void {
    super.render();
    const editor = this._editor;
    const t = editor.t;
    const doc = this.element!.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, children: Array<Node | string> = []) => {
      const node = doc.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key in node) (node as any)[key] = value;
        else node.setAttribute(key, String(value));
      }
      node.append(...children);
      return node;
    };
    const titleId = `ck-font-dialog-${Math.random().toString(36).slice(2)}`;
    const dialog = el('div', { class: 'ck-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
    dialog.append(el('h2', { class: 'ck-dialog__title', id: titleId }, [t('Font')]));

    const state = this._state;
    const preview = el('div', { class: 'ck-font-dialog__preview', 'aria-live': 'polite' }, [t('The quick brown fox jumps over the lazy dog')]);
    const updatePreview = () => {
      const style = preview.style;
      style.fontFamily = state.fontFamily || '';
      style.fontSize = sizeToCss(state.fontSize);
      style.color = state.fontColor || '';
      style.backgroundColor = state.fontBackgroundColor || '';
      style.fontWeight = state.effects.bold ? '700' : '';
      style.fontStyle = state.effects.italic ? 'italic' : '';
      style.textDecoration = [state.effects.underline ? 'underline' : '', state.effects.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ');
      style.verticalAlign = state.effects.superscript ? 'super' : state.effects.subscript ? 'sub' : '';
    };

    const field = (label: string, control: HTMLElement) => el('label', { class: 'ck-dialog__field' }, [el('span', { class: 'ck-dialog__label' }, [label]), control]);
    const grid = el('div', { class: 'ck-font-dialog__grid' });

    if (editor.commands.get('fontFamily')) {
      const select = el('select', { class: 'ck-dialog__input' });
      for (const option of normalizeFontFamilyOptions((editor.config.get('fontFamily.options') as any[]) || [])) {
        select.append(el('option', { value: option.model ?? '', selected: (option.model ?? undefined) === state.fontFamily }, [option.title]));
      }
      select.addEventListener('change', () => {
        state.fontFamily = select.value || undefined;
        updatePreview();
      });
      grid.append(field(t('Font'), select));
      this._firstField = this._firstField || select;
    }
    if (editor.commands.get('fontSize')) {
      const select = el('select', { class: 'ck-dialog__input' });
      for (const option of normalizeFontSizeOptions((editor.config.get('fontSize.options') as any[]) || [])) {
        select.append(el('option', { value: option.model ?? '', selected: (option.model ?? undefined) === state.fontSize }, [option.title]));
      }
      select.addEventListener('change', () => {
        state.fontSize = select.value || undefined;
        updatePreview();
      });
      grid.append(field(t('Size'), select));
      this._firstField = this._firstField || select;
    }
    for (const [key, label] of [['fontColor', t('Font color')], ['fontBackgroundColor', t('Highlight color')]] as const) {
      if (!editor.commands.get(key)) continue;
      const automatic = el('input', { type: 'checkbox', checked: !state[key] });
      const picker = el('input', { type: 'color', class: 'ck-dialog__color', value: toHex(doc, state[key]) || (key === 'fontColor' ? '#000000' : '#ffff00'), disabled: !state[key] });
      const sync = () => {
        picker.disabled = automatic.checked;
        state[key] = automatic.checked ? undefined : picker.value;
        updatePreview();
      };
      automatic.addEventListener('change', sync);
      picker.addEventListener('input', sync);
      grid.append(
        el('div', { class: 'ck-dialog__field' }, [
          el('span', { class: 'ck-dialog__label' }, [label]),
          el('div', { class: 'ck-dialog__inline' }, [picker, el('label', { class: 'ck-dialog__check' }, [automatic, key === 'fontColor' ? t('Automatic') : t('None')])])
        ])
      );
    }
    dialog.append(grid);

    const effects = el('fieldset', { class: 'ck-font-dialog__effects' }, [el('legend', {}, [t('Effects')])]);
    for (const [name, label] of EFFECTS) {
      if (!(name in state.effects)) continue;
      const box = el('input', { type: 'checkbox', checked: state.effects[name] });
      box.addEventListener('change', () => {
        state.effects[name] = box.checked;
        // Superscript and subscript exclude each other.
        if (box.checked && (name === 'superscript' || name === 'subscript')) {
          const other = name === 'superscript' ? 'subscript' : 'superscript';
          if (other in state.effects) {
            state.effects[other] = false;
            const otherBox = effects.querySelector<HTMLInputElement>(`input[data-effect="${other}"]`);
            if (otherBox) otherBox.checked = false;
          }
        }
        updatePreview();
      });
      box.dataset.effect = name;
      effects.append(el('label', { class: 'ck-dialog__check' }, [box, t(label)]));
    }
    if (effects.children.length > 1) dialog.append(effects);

    dialog.append(el('div', { class: 'ck-dialog__section-label' }, [t('Preview')]), el('div', { class: 'ck-font-dialog__preview-box' }, [preview]));
    const ok = el('button', { type: 'button', class: 'ck-dialog__button ck-dialog__button_primary' }, [t('OK')]);
    const cancel = el('button', { type: 'button', class: 'ck-dialog__button' }, [t('Cancel')]);
    ok.addEventListener('click', () => this.fire('submit', this._state));
    cancel.addEventListener('click', () => this.fire('cancel'));
    dialog.append(el('div', { class: 'ck-dialog__actions' }, [cancel, ok]));
    this.element!.append(dialog);
    updatePreview();

    this.element!.addEventListener('mousedown', evt => {
      if (evt.target === this.element) this.fire('cancel');
    });
    this.element!.addEventListener('keydown', evt => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        this.fire('cancel');
      } else if (evt.key === 'Enter' && (evt.target as HTMLElement).tagName !== 'BUTTON') {
        evt.preventDefault();
        this.fire('submit', this._state);
      } else if (evt.key === 'Tab') {
        // Keep focus inside the dialog.
        const focusables = [...dialog.querySelectorAll<HTMLElement>('select, input:not([disabled]), button')];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (evt.shiftKey && doc.activeElement === first) {
          evt.preventDefault();
          last.focus();
        } else if (!evt.shiftKey && doc.activeElement === last) {
          evt.preventDefault();
          first.focus();
        }
      }
    });
  }

  public focus(): void {
    (this._firstField || this.element?.querySelector<HTMLElement>('button'))?.focus();
  }
}

function sizeToCss(size: string | undefined): string {
  const presets: Record<string, string> = { tiny: '0.7em', small: '0.85em', big: '1.4em', huge: '1.8em' };
  if (!size) return '';
  return presets[size] || size;
}

/** `#rrggbb` for any CSS colour (the colour input only accepts hex). */
function toHex(doc: Document, color: string | undefined): string {
  if (!color) return '';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const probe = doc.createElement('span');
  probe.style.color = color;
  doc.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const match = rgb.match(/\d+/g);
  if (!match || match.length < 3) return '';
  return `#${match.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
}
