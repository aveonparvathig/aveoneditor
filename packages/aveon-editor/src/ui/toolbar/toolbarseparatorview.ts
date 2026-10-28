import { View } from '../view';
import type { Locale } from '../../utils/locale';

export class ToolbarSeparatorView extends View {
  constructor(locale?: Locale) {
    super(locale);
    this.setTemplate({ tag: 'span', attributes: { class: ['ck', 'ck-toolbar__separator'] } });
  }
}
