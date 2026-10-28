import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { LabeledFieldView, createLabeledInputText } from '../../ui/labeledfield/labeledfieldview';
import { ContextualBalloon } from '../../ui/panel/contextualballoon';
import { BalloonPanelView } from '../../ui/panel/balloonpanelview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../../ui/focuscycler';
import { submitHandler, clickOutsideHandler } from '../../ui/bindings';
import { icons } from '../../ui/icons';
import { ImageUtils } from './imageutils';
import type { Locale } from '../../utils/locale';
import type { InputTextView } from '../../ui/input/inputtextview';
import type { Editor } from '../../core/editor';

/** Sets the `alt` attribute of the selected image. */
export class ImageTextAlternativeCommand extends Command {
  public override refresh(): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const element = imageUtils.getClosestSelectedImageElement(this.editor.model.document.selection);
    this.isEnabled = !!element;
    if (this.isEnabled && element!.hasAttribute('alt')) {
      this.value = element!.getAttribute('alt');
    } else {
      this.value = false;
    }
  }

  public override execute(options: { newValue: string }): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const model = editor.model;
    const imageElement = imageUtils.getClosestSelectedImageElement(model.document.selection)!;
    model.change(writer => {
      writer.setAttribute('alt', options.newValue, imageElement);
    });
  }
}

export class TextAlternativeFormView extends View {
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly labeledInput: LabeledFieldView<InputTextView>;
  public readonly saveButtonView: ButtonView;
  public readonly cancelButtonView: ButtonView;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;

  constructor(locale: Locale) {
    super(locale);
    const t = locale.t;
    this.labeledInput = new LabeledFieldView(locale, createLabeledInputText);
    this.labeledInput.label = t('Text alternative');
    this.saveButtonView = this._createButton(t('Save'), icons.check, 'ck-button-save');
    this.saveButtonView.type = 'submit';
    this.cancelButtonView = this._createButton(t('Cancel'), icons.cancel, 'ck-button-cancel', 'cancel');
    this._focusCycler = new FocusCycler({ focusables: this._focusables, focusTracker: this.focusTracker, keystrokeHandler: this.keystrokes, actions: { focusPrevious: 'shift + tab', focusNext: 'tab' } });
    this.setTemplate({
      tag: 'form',
      attributes: { class: ['ck', 'ck-text-alternative-form', 'ck-responsive-form'], tabindex: '-1' },
      children: [this.labeledInput, this.saveButtonView, this.cancelButtonView]
    });
  }

  public override render(): void {
    super.render();
    this.keystrokes.listenTo(this.element as any);
    submitHandler({ view: this });
    [this.labeledInput, this.saveButtonView, this.cancelButtonView].forEach(v => {
      this._focusables.add(v);
      this.focusTracker.add(v.element!);
    });
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  private _createButton(label: string, icon: string, className: string, eventName?: string): ButtonView {
    const button = new ButtonView(this.locale);
    button.set({ label, icon, tooltip: true });
    button.extendTemplate({ attributes: { class: className } });
    if (eventName) button.delegate('execute').to(this, eventName);
    return button;
  }
}

export class ImageTextAlternativeEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils];
  }

  public static override get pluginName(): string {
    return 'ImageTextAlternativeEditing';
  }

  public override init(): void {
    this.editor.commands.add('imageTextAlternative', new ImageTextAlternativeCommand(this.editor));
  }
}

export class ImageTextAlternativeUI extends Plugin {
  private _form: TextAlternativeFormView | null = null;
  private _balloon!: ContextualBalloon;

  public static override get requires() {
    return [ContextualBalloon];
  }

  public static override get pluginName(): string {
    return 'ImageTextAlternativeUI';
  }

  public override init(): void {
    this._createButton();
  }

  public override destroy(): void {
    super.destroy();
    if (this._form) this._form.destroy();
  }

  private _createButton(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('imageTextAlternative', locale => {
      const command = editor.commands.get('imageTextAlternative')!;
      const view = new ButtonView(locale);
      view.set({ label: t('Change image text alternative'), icon: icons.imageAlt, tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      view.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      this.listenTo(view, 'execute', () => this._showForm());
      return view;
    });
  }

  private _createForm(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    this._balloon = editor.plugins.get(ContextualBalloon) as ContextualBalloon;
    this._form = new TextAlternativeFormView(editor.locale);
    this._form.render();
    this.listenTo(this._form, 'submit', () => {
      editor.execute('imageTextAlternative', { newValue: this._form!.labeledInput.fieldView.element!.value });
      this._hideForm(true);
    });
    this.listenTo(this._form, 'cancel', () => this._hideForm(true));
    this._form.keystrokes.set('Esc', (data, cancel) => {
      this._hideForm(true);
      cancel();
    });
    this.listenTo(editor.ui, 'update', () => {
      if (!imageUtils.getClosestSelectedImageWidget(viewDocument.selection)) {
        this._hideForm(true);
      } else if (this._isVisible) {
        repositionContextualBalloon(editor);
      }
    });
    clickOutsideHandler({ emitter: this._form, activator: () => this._isVisible, contextElements: () => [this._balloon.view.element], callback: () => this._hideForm() });
  }

  private _showForm(): void {
    if (this._isVisible) return;
    if (!this._form) this._createForm();
    const editor = this.editor;
    const command = editor.commands.get('imageTextAlternative')!;
    const labeledInput = this._form!.labeledInput;
    this._form!.disableCssTransitions?.();
    if (!this._isInBalloon) {
      this._balloon.add({ view: this._form!, position: getBalloonPositionData(editor) });
    }
    labeledInput.fieldView.value = labeledInput.fieldView.element!.value = (command.value as string) || '';
    this._form!.labeledInput.fieldView.select();
    this._form!.enableCssTransitions?.();
  }

  private _hideForm(focusEditable = false): void {
    if (!this._isInBalloon) return;
    if (this._form!.focusTracker.isFocused) {
      this._form!.saveButtonView.focus();
    }
    this._balloon.remove(this._form!);
    if (focusEditable) this.editor.editing.view.focus();
  }

  private get _isVisible(): boolean {
    return !!this._form && this._balloon.visibleView === this._form;
  }

  private get _isInBalloon(): boolean {
    return !!this._form && this._balloon.hasView(this._form);
  }
}

export function repositionContextualBalloon(editor: Editor): void {
  const balloon = editor.plugins.get('ContextualBalloon') as ContextualBalloon;
  const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
  if (imageUtils.getClosestSelectedImageWidget(editor.editing.view.document.selection)) {
    balloon.updatePosition(getBalloonPositionData(editor));
  }
}

export function getBalloonPositionData(editor: Editor): any {
  const editingView = editor.editing.view;
  const defaultPositions = BalloonPanelView.defaultPositions;
  const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
  return {
    target: editingView.domConverter.mapViewToDom(imageUtils.getClosestSelectedImageWidget(editingView.document.selection)!),
    positions: [defaultPositions.northArrowSouth, defaultPositions.northArrowSouthWest, defaultPositions.northArrowSouthEast, defaultPositions.southArrowNorth, defaultPositions.southArrowNorthWest, defaultPositions.southArrowNorthEast, defaultPositions.viewportStickyNorth]
  };
}

export class ImageTextAlternative extends Plugin {
  public static override get requires() {
    return [ImageTextAlternativeEditing, ImageTextAlternativeUI];
  }

  public static override get pluginName(): string {
    return 'ImageTextAlternative';
  }
}
