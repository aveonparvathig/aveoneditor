import { View } from '../view';
import { ViewCollection } from '../viewcollection';
import type { Locale } from '../../utils/locale';

/** Collection of views rendered into a `.ck-body` wrapper in `document.body` (balloons, tooltips). */
export class BodyCollection extends ViewCollection {
  private _bodyCollectionContainer: HTMLElement | null = null;

  constructor(locale?: Locale, initialItems: Iterable<View> = []) {
    super(initialItems);
    (this as any).locale = locale;
  }

  public get bodyCollectionContainer(): HTMLElement | null {
    return this._bodyCollectionContainer;
  }

  public attachToDom(): void {
    const template = new (require_template())({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-reset_all', 'ck-body', 'ck-rounded-corners'],
        dir: this.locale ? this.locale.uiLanguageDirection : 'ltr'
      },
      children: this
    });
    this._bodyCollectionContainer = template.render() as HTMLElement;
    let wrapper = document.querySelector('.ck-body-wrapper') as HTMLElement | null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.classList.add('ck-body-wrapper');
      document.body.appendChild(wrapper);
    }
    wrapper.appendChild(this._bodyCollectionContainer);
  }

  public detachFromDom(): void {
    this.stopListening();
    if (this._bodyCollectionContainer) {
      this._bodyCollectionContainer.remove();
    }
    const wrapper = document.querySelector('.ck-body-wrapper');
    if (wrapper && wrapper.childElementCount === 0) {
      wrapper.remove();
    }
  }
}

/** Root view of the editor UI. Owns the body collection. */
export class EditorUIView extends View {
  public readonly body: BodyCollection;

  constructor(locale?: Locale) {
    super(locale);
    this.body = new BodyCollection(locale);
  }

  public override render(): void {
    super.render();
    this.body.attachToDom();
  }

  public override destroy(): void {
    this.body.detachFromDom();
    super.destroy();
  }
}

/** Editor UI with a top (toolbar) and main (editable) area in a box. */
export class BoxedEditorUIView extends EditorUIView {
  public readonly top = this.createCollection();
  public readonly main = this.createCollection();

  constructor(locale?: Locale) {
    super(locale);
    const ariaLabelUid = `ck-editor__aria-label_${Math.random().toString(36).slice(2, 8)}`;
    const t = locale ? locale.t : (s: string) => s;
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-reset', 'ck-editor', 'ck-rounded-corners'],
        role: 'application',
        dir: locale ? locale.uiLanguageDirection : 'ltr',
        lang: locale ? locale.uiLanguage : 'en',
        'aria-labelledby': ariaLabelUid
      },
      children: [
        { tag: 'label', attributes: { id: ariaLabelUid, class: 'ck-voice-label' }, children: [t('Rich Text Editor')] },
        { tag: 'div', attributes: { class: ['ck', 'ck-editor__top', 'ck-reset_all'], role: 'presentation' }, children: this.top },
        { tag: 'div', attributes: { class: ['ck', 'ck-editor__main'], role: 'presentation' }, children: this.main }
      ]
    });
  }
}

import { Template } from '../template';
function require_template(): typeof Template {
  return Template;
}
