import { View } from '../view';
import { FocusTracker } from '../../utils/focustracker';
import type { Locale } from '../../utils/locale';

/** Text input view. Fires `input` on changes. */
export class InputTextView extends View {
  declare public value: string;
  declare public id: string | undefined;
  declare public placeholder: string | undefined;
  declare public isReadOnly: boolean;
  declare public hasError: boolean;
  declare public ariaDescribedById: string | undefined;
  declare public isFocused: boolean;
  declare public isEmpty: boolean;
  declare public inputMode: string;
  public readonly focusTracker = new FocusTracker();
  declare public element: HTMLInputElement | null;

  constructor(locale?: Locale) {
    super(locale);
    this.set('value', '');
    this.set('id', undefined);
    this.set('placeholder', undefined);
    this.set('isReadOnly', false);
    this.set('hasError', false);
    this.set('ariaDescribedById', undefined);
    this.set('inputMode', 'text');
    this.set('isFocused', false);
    this.set('isEmpty', true);
    this.bind('isFocused').to(this.focusTracker);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'input',
      attributes: {
        class: ['ck', 'ck-input', 'ck-input-text', bind.if('isFocused', 'ck-input_focused'), bind.if('isEmpty', 'ck-input-text_empty'), bind.if('hasError', 'ck-error')],
        id: bind.to('id'),
        placeholder: bind.to('placeholder'),
        type: 'text',
        inputmode: bind.to('inputMode'),
        readonly: bind.to('isReadOnly'),
        'aria-invalid': bind.if('hasError', true),
        'aria-describedby': bind.to('ariaDescribedById')
      },
      on: {
        input: bind.to((evt: Event) => {
          this.fire('input', evt);
          this._updateIsEmpty();
        }),
        change: bind.to(() => this._updateIsEmpty())
      }
    });
  }

  public override render(): void {
    super.render();
    this.focusTracker.add(this.element!);
    this._setDomElementValue(this.value);
    this._updateIsEmpty();
    this.on('change:value', (evt, name, value: string) => {
      this._setDomElementValue(value);
      this._updateIsEmpty();
    });
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
  }

  public select(): void {
    this.element!.select();
  }

  public focus(): void {
    this.element!.focus();
  }

  public reset(): void {
    this.value = '';
    this.element!.value = '';
    this._updateIsEmpty();
  }

  private _updateIsEmpty(): void {
    this.isEmpty = this.element ? !this.element.value : !this.value;
  }

  private _setDomElementValue(value: string): void {
    this.element!.value = !value && value !== '0' ? '' : String(value);
  }
}
