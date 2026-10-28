import { View } from '../view';
import { LabelView } from '../label/labelview';
import { InputTextView } from '../input/inputtextview';
import { uid } from '../../utils/uid';
import type { Locale } from '../../utils/locale';

/** A field (input, dropdown...) with a label, error and info text. */
export class LabeledFieldView<TField extends View = View> extends View {
  declare public label: string | undefined;
  declare public isEnabled: boolean;
  declare public isEmpty: boolean;
  declare public isFocused: boolean;
  declare public errorText: string | null;
  declare public infoText: string | null;
  declare public class: string | undefined;
  declare public placeholder: string | undefined;
  public readonly fieldView: TField;
  public readonly labelView: LabelView;
  public readonly statusView: View;
  public readonly fieldWrapperChildren = this.createCollection();

  constructor(locale: Locale | undefined, viewCreator: (labeledFieldView: LabeledFieldView<TField>, viewUid: string, statusUid: string) => TField) {
    super(locale);
    const viewUid = `ck-labeled-field-view-${uid()}`;
    const statusUid = `ck-labeled-field-view-status-${uid()}`;
    this.fieldView = viewCreator(this, viewUid, statusUid);
    this.set('label', undefined);
    this.set('isEnabled', true);
    this.set('isEmpty', true);
    this.set('isFocused', false);
    this.set('errorText', null);
    this.set('infoText', null);
    this.set('class', undefined);
    this.set('placeholder', undefined);
    this.labelView = this._createLabelView(viewUid);
    this.statusView = this._createStatusView(statusUid);
    this.fieldWrapperChildren.addMany([this.fieldView, this.labelView]);
    this.bind('_statusText' as any).to(this, 'errorText', this, 'infoText', (errorText: string | null, infoText: string | null) => errorText || infoText);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-labeled-field-view', bind.to('class'), bind.if('isEnabled', 'ck-disabled', value => !value), bind.if('isEmpty', 'ck-labeled-field-view_empty'), bind.if('isFocused', 'ck-labeled-field-view_focused'), bind.if('placeholder', 'ck-labeled-field-view_placeholder'), bind.if('errorText', 'ck-error')]
      },
      children: [
        { tag: 'div', attributes: { class: ['ck', 'ck-labeled-field-view__input-wrapper'] }, children: this.fieldWrapperChildren },
        this.statusView
      ]
    });
  }

  public focus(): void {
    (this.fieldView as any).focus();
  }

  private _createLabelView(id: string): LabelView {
    const labelView = new LabelView(this.locale);
    labelView.for = id;
    labelView.bind('text').to(this, 'label');
    return labelView;
  }

  private _createStatusView(statusUid: string): View {
    const statusView = new View(this.locale);
    const bind = this.bindTemplate;
    statusView.setTemplate({
      tag: 'div',
      attributes: {
        class: ['ck', 'ck-labeled-field-view__status', bind.if('errorText', 'ck-labeled-field-view__status_error'), bind.if('_statusText' as any, 'ck-hidden', value => !value)],
        id: statusUid,
        role: bind.if('errorText', 'alert')
      },
      children: [{ text: bind.to('_statusText' as any) }]
    });
    return statusView;
  }
}

/** Creates a labeled text input. */
export function createLabeledInputText(labeledFieldView: LabeledFieldView<InputTextView>, viewUid: string, statusUid: string): InputTextView {
  const inputView = new InputTextView(labeledFieldView.locale);
  inputView.set({ id: viewUid, ariaDescribedById: statusUid });
  inputView.bind('isReadOnly').to(labeledFieldView, 'isEnabled', (value: unknown) => !value);
  inputView.bind('hasError').to(labeledFieldView, 'errorText', (value: unknown) => !!value);
  inputView.on('input', () => {
    labeledFieldView.errorText = null;
  });
  labeledFieldView.bind('isEmpty', 'isFocused', 'placeholder').to(inputView);
  return inputView;
}
