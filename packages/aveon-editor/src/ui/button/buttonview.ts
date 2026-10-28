import { View } from '../view';
import { IconView } from '../icon/iconview';
import { getEnvKeystrokeText } from '../../utils/keyboard';
import type { Locale } from '../../utils/locale';
import { uid } from '../../utils/uid';

export interface ButtonLike {
  label?: string;
  icon?: string;
  tooltip?: boolean | string;
  isOn?: boolean;
  isEnabled?: boolean;
  isVisible?: boolean;
  withText?: boolean;
  keystroke?: string;
  class?: string;
}

/** Standard toolbar/UI button. Fires `execute` on click. */
export class ButtonView extends View {
  declare public label: string | undefined;
  declare public icon: string | undefined;
  declare public tooltip: boolean | string | undefined;
  declare public tooltipPosition: 's' | 'n' | 'e' | 'w' | 'sw' | 'se';
  declare public isOn: boolean;
  declare public isEnabled: boolean;
  declare public isVisible: boolean;
  declare public isToggleable: boolean;
  declare public withText: boolean;
  declare public withKeystroke: boolean;
  declare public keystroke: string | undefined;
  declare public class: string | undefined;
  declare public type: 'button' | 'submit' | 'reset' | 'menu';
  declare public tabindex: number;
  declare public ariaLabel: string | undefined;
  declare public ariaLabelledBy: string | undefined;
  declare public labelStyle: string | undefined;
  declare public role: string | undefined;
  public readonly children = this.createCollection();
  public readonly labelView: View;
  public readonly iconView = new IconView();
  public readonly keystrokeView: View;
  private _tooltipString = '';

  constructor(locale?: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    const ariaLabelUid = uid();

    this.set('ariaLabel', undefined);
    this.set('ariaLabelledBy', `ck-editor__aria-label_${ariaLabelUid}`);
    this.set('class', undefined);
    this.set('labelStyle', undefined);
    this.set('icon', undefined);
    this.set('isEnabled', true);
    this.set('isOn', false);
    this.set('isVisible', true);
    this.set('isToggleable', false);
    this.set('keystroke', undefined);
    this.set('label', undefined);
    this.set('role', undefined);
    this.set('tabindex', -1);
    this.set('tooltip', false);
    this.set('tooltipPosition', 's');
    this.set('type', 'button');
    this.set('withText', false);
    this.set('withKeystroke', false);

    this.labelView = this._createLabelView(ariaLabelUid);
    this.keystrokeView = this._createKeystrokeView();

    this.bind('_tooltipString' as any).to(this, 'tooltip', this, 'label', this, 'keystroke', (tooltip: boolean | string, label: string, keystroke: string) => getTooltipString(tooltip, label, keystroke));

    this.setTemplate({
      tag: 'button',
      attributes: {
        class: [
          'ck',
          'ck-button',
          bind.to('class'),
          bind.if('isEnabled', 'ck-disabled', value => !value),
          bind.if('isVisible', 'ck-hidden', value => !value),
          bind.to('isOn', value => (value ? 'ck-on' : 'ck-off')),
          bind.if('withText', 'ck-button_with-text'),
          bind.if('withKeystroke', 'ck-button_with-keystroke')
        ],
        role: bind.to('role'),
        type: bind.to('type', value => (value ? value : 'button')),
        tabindex: bind.to('tabindex'),
        'aria-label': bind.to('ariaLabel'),
        'aria-labelledby': bind.to('ariaLabelledBy'),
        'aria-disabled': bind.if('isEnabled', true, value => !value),
        'aria-pressed': bind.to('isOn', value => (this.isToggleable ? String(!!value) : false)),
        'data-cke-tooltip-text': bind.to('_tooltipString' as any),
        'data-cke-tooltip-position': bind.to('tooltipPosition')
      },
      children: this.children,
      on: {
        click: bind.to((evt: Event) => {
          if (this.isEnabled) {
            this.fire('execute');
          } else {
            evt.preventDefault();
          }
        }),
        mousedown: bind.to((evt: Event) => {
          evt.preventDefault();
        })
      }
    });
  }

  public override render(): void {
    super.render();
    if (this.icon) {
      this.iconView.bind('content').to(this, 'icon');
      this.children.add(this.iconView);
    }
    this.children.add(this.labelView);
    if (this.withKeystroke && this.keystroke) {
      this.children.add(this.keystrokeView);
    }
  }

  public focus(): void {
    this.element!.focus();
  }

  private _createLabelView(ariaLabelUid: string): View {
    const labelView = new View();
    const bind = this.bindTemplate;
    labelView.setTemplate({
      tag: 'span',
      attributes: {
        class: ['ck', 'ck-button__label'],
        style: { 'text-align': bind.to('labelStyle' as any, value => (value as string) || '') } as any,
        id: `ck-editor__aria-label_${ariaLabelUid}`
      },
      children: [{ text: bind.to('label') }]
    });
    return labelView;
  }

  private _createKeystrokeView(): View {
    const keystrokeView = new View();
    keystrokeView.setTemplate({
      tag: 'span',
      attributes: { class: ['ck', 'ck-button__keystroke'] },
      children: [{ text: this.bindTemplate.to('keystroke', text => getEnvKeystrokeText(String(text || ''))) }]
    });
    return keystrokeView;
  }
}

function getTooltipString(tooltip: boolean | string | undefined, label: string | undefined, keystroke: string | undefined): string {
  if (tooltip === true) {
    if (keystroke) {
      return `${label || ''} (${getEnvKeystrokeText(keystroke)})`;
    }
    return label || '';
  }
  if (typeof tooltip === 'string') return tooltip;
  return '';
}
