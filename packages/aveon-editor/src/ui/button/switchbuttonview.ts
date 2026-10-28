import { ButtonView } from './buttonview';
import { View } from '../view';
import type { Locale } from '../../utils/locale';

/** A toggle switch button (label + switch). */
export class SwitchButtonView extends ButtonView {
  public readonly toggleSwitchView: View;

  constructor(locale?: Locale) {
    super(locale);
    this.isToggleable = true;
    this.toggleSwitchView = this._createToggleView();
    this.extendTemplate({ attributes: { class: 'ck-switchbutton' } });
  }

  public override render(): void {
    super.render();
    this.children.add(this.toggleSwitchView);
  }

  private _createToggleView(): View {
    const toggleSwitchView = new View();
    toggleSwitchView.setTemplate({
      tag: 'span',
      attributes: { class: ['ck', 'ck-button__toggle'] },
      children: [{ tag: 'span', attributes: { class: ['ck', 'ck-button__toggle__inner'] } }]
    });
    return toggleSwitchView;
  }
}
