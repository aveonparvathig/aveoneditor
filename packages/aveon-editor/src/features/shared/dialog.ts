/**
 * Small modal dialogs shared by features (footnote text, comments, captions…). They reuse the
 * `.ck-dialog` styles of the Font dialog and return focus to the content when closed.
 */

import type { Editor } from '../../core/editor';
import { applyTheme } from '../../ui/theme';

export interface PromptOptions {
  title: string;
  label: string;
  value?: string;
  /** A textarea instead of a single-line input. */
  multiline?: boolean;
  placeholder?: string;
  submitLabel?: string;
  /** Adds a "Remove" button; the promise then resolves with `''`. */
  removable?: boolean;
}

let uid = 0;

/** Asks for a piece of text. Resolves with the text, `''` for Remove, or `null` when cancelled. */
export function promptDialog(editor: Editor, options: PromptOptions): Promise<string | null> {
  const t = editor.t;
  const doc = editor.ui.element?.ownerDocument || document;
  return new Promise(resolve => {
    const overlay = doc.createElement('div');
    overlay.className = 'ck ck-dialog-overlay ck-reset_all-excluded';
    applyTheme(editor, overlay);
    const titleId = `ck-prompt-${++uid}`;
    const dialog = doc.createElement('div');
    dialog.className = 'ck-dialog ck-dialog_prompt';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', titleId);

    const title = doc.createElement('h2');
    title.className = 'ck-dialog__title';
    title.id = titleId;
    title.textContent = options.title;

    const field = doc.createElement('label');
    field.className = 'ck-dialog__field';
    const label = doc.createElement('span');
    label.className = 'ck-dialog__label';
    label.textContent = options.label;
    const input = doc.createElement(options.multiline ? 'textarea' : 'input') as HTMLInputElement | HTMLTextAreaElement;
    input.className = 'ck-dialog__input';
    input.value = options.value || '';
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.multiline) (input as HTMLTextAreaElement).rows = 4;
    field.append(label, input);

    const actions = doc.createElement('div');
    actions.className = 'ck-dialog__actions';
    const button = (text: string, className: string, onClick: () => void) => {
      const element = doc.createElement('button');
      element.type = 'button';
      element.className = `ck-dialog__button ${className}`;
      element.textContent = text;
      element.addEventListener('click', onClick);
      return element;
    };
    const close = (result: string | null) => {
      overlay.remove();
      editor.editing.view.focus();
      resolve(result);
    };
    if (options.removable) {
      const remove = button(t('Remove'), 'ck-dialog__button_danger', () => close(''));
      actions.append(remove);
    }
    actions.append(
      button(t('Cancel'), '', () => close(null)),
      button(options.submitLabel || t('OK'), 'ck-dialog__button_primary', () => close(input.value.trim() || (options.removable ? '' : null)))
    );
    dialog.append(title, field, actions);
    overlay.append(dialog);
    overlay.addEventListener('mousedown', evt => {
      if (evt.target === overlay) close(null);
    });
    overlay.addEventListener('keydown', evt => {
      if (evt.key === 'Escape') {
        evt.preventDefault();
        close(null);
      } else if (evt.key === 'Enter' && (!options.multiline || evt.ctrlKey || evt.metaKey) && evt.target === input) {
        evt.preventDefault();
        close(input.value.trim() || (options.removable ? '' : null));
      }
    });
    doc.body.appendChild(overlay);
    input.focus();
    input.select?.();
  });
}
