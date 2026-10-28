import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { SplitButtonView } from '../../ui/button/splitbuttonview';
import { LabeledFieldView, createLabeledInputText } from '../../ui/labeledfield/labeledfieldview';
import { createDropdown } from '../../ui/dropdown/dropdownview';
import { FocusTracker } from '../../utils/focustracker';
import { KeystrokeHandler } from '../../utils/keystrokehandler';
import { FocusCycler } from '../../ui/focuscycler';
import { submitHandler } from '../../ui/bindings';
import { icons } from '../../ui/icons';
import { FileDialogButtonView, createImageTypeRegExp } from './imageupload';
import { ImageUtils } from './imageutils';
import type { Locale } from '../../utils/locale';
import type { InputTextView } from '../../ui/input/inputtextview';

/** URL form shown in the "Insert image" dropdown. */
export class ImageInsertUrlView extends View {
  public readonly focusTracker = new FocusTracker();
  public readonly keystrokes = new KeystrokeHandler();
  public readonly urlInputView: LabeledFieldView<InputTextView>;
  public readonly insertButtonView: ButtonView;
  public readonly cancelButtonView: ButtonView;
  declare public imageURLInputValue: string;
  declare public isImageSelected: boolean;
  declare public isEnabled: boolean;
  private readonly _focusables = this.createCollection();
  private readonly _focusCycler: FocusCycler;

  constructor(locale: Locale) {
    super(locale);
    const t = locale.t;
    this.set('imageURLInputValue', '');
    this.set('isImageSelected', false);
    this.set('isEnabled', true);
    this.urlInputView = this._createUrlInputView();
    this.insertButtonView = this._createInsertButton();
    this.cancelButtonView = this._createCancelButton();
    this._focusCycler = new FocusCycler({ focusables: this._focusables, focusTracker: this.focusTracker, keystrokeHandler: this.keystrokes, actions: { focusPrevious: 'shift + tab', focusNext: 'tab' } });
    this.setTemplate({
      tag: 'form',
      attributes: { class: ['ck', 'ck-image-insert-url', 'ck-insert-url-form'], tabindex: '-1' },
      children: [this.urlInputView, { tag: 'div', attributes: { class: ['ck', 'ck-image-insert-url__action-row'] }, children: [this.insertButtonView, this.cancelButtonView] }]
    });
    void t;
  }

  public override render(): void {
    super.render();
    submitHandler({ view: this });
    [this.urlInputView, this.insertButtonView, this.cancelButtonView].forEach(v => {
      this._focusables.add(v);
      this.focusTracker.add(v.element!);
    });
    this.keystrokes.listenTo(this.element as any);
  }

  public override destroy(): void {
    super.destroy();
    this.focusTracker.destroy();
    this.keystrokes.destroy();
  }

  public focus(): void {
    this._focusCycler.focusFirst();
  }

  private _createUrlInputView(): LabeledFieldView<InputTextView> {
    const t = this.locale!.t;
    const labeledInput = new LabeledFieldView(this.locale, createLabeledInputText);
    labeledInput.bind('label').to(this, 'isImageSelected', (value: boolean) => (value ? t('Update image URL') : t('Insert image via URL')));
    labeledInput.fieldView.placeholder = 'https://example.com/image.png';
    labeledInput.fieldView.bind('value').to(this, 'imageURLInputValue', (value: string) => value || '');
    labeledInput.fieldView.on('input', () => {
      this.imageURLInputValue = labeledInput.fieldView.element!.value.trim();
    });
    return labeledInput;
  }

  private _createInsertButton(): ButtonView {
    const t = this.locale!.t;
    const button = new ButtonView(this.locale);
    button.set({ icon: icons.check, class: 'ck-button-save', type: 'submit', withText: true });
    button.bind('label').to(this, 'isImageSelected', (value: boolean) => (value ? t('Update') : t('Insert')));
    button.bind('isEnabled').to(this, 'imageURLInputValue', this, 'isEnabled', (...values: unknown[]) => values.every(value => value));
    button.delegate('execute').to(this, 'submit');
    return button;
  }

  private _createCancelButton(): ButtonView {
    const t = this.locale!.t;
    const button = new ButtonView(this.locale);
    button.set({ label: t('Cancel'), icon: icons.cancel, class: 'ck-button-cancel', withText: true });
    button.delegate('execute').to(this, 'cancel');
    return button;
  }
}

/** "Insert image" dropdown: upload from computer (main button) and insert via URL (panel). */
export class ImageInsertUI extends Plugin {
  public static override get pluginName(): string {
    return 'ImageInsertUI';
  }

  public static override get requires() {
    return [ImageUtils];
  }

  public override init(): void {
    const editor = this.editor;
    const componentCreator = (locale: Locale) => this._createDropdownView(locale);
    editor.ui.componentFactory.add('insertImage', componentCreator);
    editor.ui.componentFactory.add('imageInsert', componentCreator);
  }

  private _createDropdownView(locale: Locale): any {
    const editor = this.editor;
    const t = locale.t;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const uploadImageCommand = editor.commands.get('uploadImage');
    const insertImageCommand = editor.commands.get('insertImage')!;
    const imageTypes = (editor.config.get('image.upload.types') as string[]) || ['jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'];

    let dropdownButton: any;
    if (uploadImageCommand) {
      const fileButton = new FileDialogButtonView(locale);
      fileButton.set({ acceptedType: imageTypes.map(type => `image/${type}`).join(','), allowMultipleFiles: true, label: t('Insert image'), icon: icons.image, tooltip: true });
      fileButton.bind('isEnabled').to(uploadImageCommand);
      fileButton.on('done', (evt, files: FileList) => {
        const imagesToUpload = Array.from(files).filter(file => createImageTypeRegExp(imageTypes).test(file.type));
        if (imagesToUpload.length) {
          editor.execute('uploadImage', { file: imagesToUpload });
          editor.editing.view.focus();
        }
      });
      dropdownButton = new SplitButtonView(locale, fileButton);
    } else {
      dropdownButton = undefined;
    }

    const dropdownView = createDropdown(locale, dropdownButton);
    const panelButton = dropdownView.buttonView as any;
    if (!uploadImageCommand) {
      panelButton.set({ label: t('Insert image'), icon: icons.image, tooltip: true });
    }
    dropdownView.bind('isEnabled').to(insertImageCommand);

    const urlView = new ImageInsertUrlView(locale);
    urlView.bind('isImageSelected').to(insertImageCommand as any, 'isEnabled', () => {
      const selectedElement = editor.model.document.selection.getSelectedElement();
      return !!selectedElement && imageUtils.isImage(selectedElement);
    });
    dropdownView.panelView.children.add(urlView);
    dropdownView.on('change:isOpen', () => {
      const selectedElement = editor.model.document.selection.getSelectedElement();
      if (dropdownView.isOpen) {
        if (selectedElement && imageUtils.isImage(selectedElement)) {
          urlView.imageURLInputValue = (selectedElement.getAttribute('src') as string) || '';
          urlView.isImageSelected = true;
        } else {
          urlView.imageURLInputValue = '';
          urlView.isImageSelected = false;
        }
        setTimeout(() => urlView.focus(), 0);
      }
    });
    urlView.on('submit', () => {
      const selectedElement = editor.model.document.selection.getSelectedElement();
      if (selectedElement && imageUtils.isImage(selectedElement)) {
        editor.model.change(writer => writer.setAttribute('src', urlView.imageURLInputValue, selectedElement));
      } else {
        editor.execute('insertImage', { source: urlView.imageURLInputValue });
      }
      dropdownView.isOpen = false;
      editor.editing.view.focus();
    });
    urlView.on('cancel', () => {
      dropdownView.isOpen = false;
      editor.editing.view.focus();
    });
    urlView.keystrokes.set('Esc', (data, cancel) => {
      dropdownView.isOpen = false;
      editor.editing.view.focus();
      cancel();
    });
    dropdownView.extendTemplate({ attributes: { class: ['ck-image-insert-dropdown'] } });
    return dropdownView;
  }
}

export class ImageInsertViaUrl extends Plugin {
  public static override get pluginName(): string {
    return 'ImageInsertViaUrl';
  }

  public static override get requires() {
    return [ImageInsertUI];
  }
}

export class ImageInsert extends Plugin {
  public static override get pluginName(): string {
    return 'ImageInsert';
  }

  public static override get requires() {
    return [ImageInsertUI];
  }
}
