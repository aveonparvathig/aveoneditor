import { View } from '../view';
import { uid } from '../../utils/uid';
import type { Locale } from '../../utils/locale';

/** A `<label>` element. */
export class LabelView extends View {
  declare public text: string | undefined;
  declare public for: string | undefined;
  public readonly id: string;

  constructor(locale?: Locale) {
    super(locale);
    this.set('text', undefined);
    this.set('for', undefined);
    this.id = `ck-editor__label_${uid()}`;
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'label',
      attributes: { class: ['ck', 'ck-label'], id: this.id, for: bind.to('for') },
      children: [{ text: bind.to('text') }]
    });
  }
}
