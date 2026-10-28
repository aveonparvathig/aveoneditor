import { View } from '../view';
import { ButtonView } from './buttonview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { icons } from '../icons';
import type { Locale } from '../../utils/locale';

/** Button with a separate arrow part that opens a dropdown. */
export class SplitButtonView extends View {
  declare public label: string | undefined;
  declare public icon: string | undefined;
  declare public tooltip: boolean | string | undefined;
  declare public isOn: boolean;
  declare public isEnabled: boolean;
  declare public isVisible: boolean;
  declare public isToggleable: boolean;
  declare public withText: boolean;
  declare public keystroke: string | undefined;
  declare public class: string | undefined;
  declare public tabindex: number;
  public readonly actionView: ButtonView;
  public readonly arrowView: ButtonView;
  public readonly children = this.createCollection();
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();

  constructor(locale?: Locale, actionButton?: ButtonView) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('class', undefined);
    this.set('icon', undefined);
    this.set('isEnabled', true);
    this.set('isOn', false);
    this.set('isToggleable', false);
    this.set('isVisible', true);
    this.set('keystroke', undefined);
    this.set('withKeystroke' as any, false);
    this.set('label', undefined);
    this.set('tabindex', -1);
    this.set('tooltip', false);
    this.set('withText', false);

    this.actionView = this._createActionView(actionButton);
    this.arrowView = this._createArrowView();

    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-splitbutton', bind.to('class'), bind.if('isVisible', 'ck-hidden', value => !value), this.arrowView.bindTemplate.if('isOn', 'ck-splitbutton_open')]
      },
      children: this.children
    });
  }

  public override render(): void {
    super.render();
    this.children.add(this.actionView);
    this.children.add(this.arrowView);
    this.focusTracker.add(this.actionView.element!);
    this.focusTracker.add(this.arrowView.element!);
    this.keystrokes.listenTo(this.element as any);
    this.keystrokes.set('arrowright', (evt, cancel) => {
      if (this.focusTracker.focusedElement === this.actionView.element) {
        this.arrowView.focus();
        cancel();
      }
    });
    this.keystrokes.set('arrowleft', (evt, cancel) => {
      if (this.focusTracker.focusedElement === this.arrowView.element) {
        this.actionView.focus();
        cancel();
      }
    });
  }

  public focus(): void {
    this.actionView.focus();
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  private _createActionView(actionButton?: ButtonView): ButtonView {
    const actionView = actionButton || new ButtonView();
    if (!actionButton) {
      actionView.bind('icon', 'isEnabled', 'isOn', 'isToggleable', 'keystroke', 'label', 'tabindex', 'tooltip', 'withText').to(this);
    }
    actionView.extendTemplate({ attributes: { class: 'ck-splitbutton__action' } });
    actionView.delegate('execute').to(this);
    return actionView;
  }

  private _createArrowView(): ButtonView {
    const arrowView = new ButtonView();
    const bind = arrowView.bindTemplate;
    arrowView.icon = icons.dropdownArrow;
    arrowView.extendTemplate({
      attributes: {
        class: ['ck-splitbutton__arrow'],
        'data-cke-tooltip-disabled': bind.to('isOn'),
        'aria-haspopup': true,
        'aria-expanded': bind.to('isOn', value => String(value))
      }
    });
    arrowView.bind('isEnabled').to(this);
    arrowView.bind('label').to(this);
    arrowView.bind('tooltip').to(this);
    arrowView.delegate('execute').to(this, 'open');
    return arrowView;
  }
}
