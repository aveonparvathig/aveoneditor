import { View } from '../view';
import type { Locale } from '../../utils/locale';
import type { View as EditingView } from '../../engine/view/view';

/** Base view of an editable element. */
export class EditableUIView extends View {
  public name: string | null = null;
  declare public isFocused: boolean;
  protected _editingView: EditingView;
  private _editableElement: HTMLElement | null | undefined;
  private _hasExternalElement: boolean;

  constructor(locale: Locale | undefined, editingView: EditingView, editableElement?: HTMLElement) {
    super(locale);
    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-content', 'ck-editor__editable', 'ck-rounded-corners'], lang: locale ? locale.contentLanguage : undefined, dir: locale ? locale.contentLanguageDirection : undefined } });
    this.set('isFocused', false);
    this._editableElement = editableElement;
    this._hasExternalElement = !!this._editableElement;
    this._editingView = editingView;
  }

  public override render(): void {
    super.render();
    if (this._hasExternalElement) {
      this.template!.apply((this.element = this._editableElement!));
    } else {
      this._editableElement = this.element;
    }
    this.on('change:isFocused', () => this._updateIsFocusedClasses());
    this._updateIsFocusedClasses();
  }

  public override destroy(): void {
    if (this._hasExternalElement) {
      this.template!.revert(this._editableElement!);
    }
    super.destroy();
  }

  public get hasExternalElement(): boolean {
    return this._hasExternalElement;
  }

  private _updateIsFocusedClasses(): void {
    const editingView = this._editingView;
    if (editingView.isRenderingInProgress) {
      updateAfterRender(this);
    } else {
      update(this);
    }

    function update(view: EditableUIView) {
      editingView.change(writer => {
        const viewRoot = editingView.document.getRoot(view.name!);
        if (!viewRoot) return;
        writer.addClass(view.isFocused ? 'ck-focused' : 'ck-blurred', viewRoot);
        writer.removeClass(view.isFocused ? 'ck-blurred' : 'ck-focused', viewRoot);
      });
    }

    function updateAfterRender(view: EditableUIView) {
      editingView.once('change:isRenderingInProgress', (evt, name, value: boolean) => {
        if (!value) update(view);
        else updateAfterRender(view);
      });
    }
  }
}

/** Inline editable (used by classic, inline and balloon editors). */
export class InlineEditableUIView extends EditableUIView {
  private readonly _generateLabel: (view: InlineEditableUIView) => string;

  constructor(locale: Locale | undefined, editingView: EditingView, editableElement?: HTMLElement, options: { label?: string | ((view: InlineEditableUIView) => string) } = {}) {
    super(locale, editingView, editableElement);
    const t = locale ? locale.t : (s: string, _v?: unknown) => s;
    this.extendTemplate({
      attributes: {
        role: 'textbox',
        class: 'ck-editor__editable_inline'
      }
    });
    this._generateLabel = typeof options.label === 'function' ? options.label : () => (typeof options.label === 'string' ? options.label : t('Editor editing area: %0', this.name || 'main'));
  }

  public override render(): void {
    super.render();
    const editingView = this._editingView;
    editingView.change(writer => {
      const viewRoot = editingView.document.getRoot(this.name!);
      if (!viewRoot) return;
      writer.setAttribute('aria-label', this._generateLabel(this), viewRoot);
    });
  }
}
