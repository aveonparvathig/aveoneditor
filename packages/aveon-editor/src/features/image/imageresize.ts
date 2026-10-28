import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { ImageUtils } from './imageutils';
import type { Editor } from '../../core/editor';

export interface ImageResizeOption {
  name: string;
  value: string | null;
  icon?: string;
  label?: string;
}

/** Sets the width of the selected image (`resizedWidth`, rendered as inline style). */
export class ResizeImageCommand extends Command {
  public override refresh(): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const element = imageUtils.getClosestSelectedImageElement(editor.model.document.selection);
    this.isEnabled = !!element;
    if (!element || !element.hasAttribute('resizedWidth')) {
      this.value = null;
    } else {
      this.value = { width: element.getAttribute('resizedWidth'), height: null };
    }
  }

  public override execute(options: { width: string | null }): void {
    const editor = this.editor;
    const model = editor.model;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const imageElement = imageUtils.getClosestSelectedImageElement(model.document.selection)!;
    this.value = { width: options.width, height: null };
    if (imageElement) {
      model.change(writer => {
        if (options.width) {
          writer.setAttribute('resizedWidth', options.width, imageElement);
        } else {
          writer.removeAttribute('resizedWidth', imageElement);
        }
      });
    }
  }
}

export class ImageResizeEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils];
  }

  public static override get pluginName(): string {
    return 'ImageResizeEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('image', {
      resizeUnit: '%',
      resizeOptions: [
        { name: 'resizeImage:original', value: null, icon: 'original' },
        { name: 'resizeImage:25', value: '25', icon: 'small' },
        { name: 'resizeImage:50', value: '50', icon: 'medium' },
        { name: 'resizeImage:75', value: '75', icon: 'large' }
      ]
    });
  }

  public override init(): void {
    const editor = this.editor;
    const resizeImageCommand = new ResizeImageCommand(editor);
    this._registerConverters('imageBlock');
    this._registerConverters('imageInline');
    editor.commands.add('resizeImage', resizeImageCommand);
    editor.commands.add('imageResize', resizeImageCommand);
  }

  private _registerConverters(imageType: 'imageBlock' | 'imageInline'): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    if (!editor.model.schema.isRegistered(imageType)) return;
    editor.model.schema.extend(imageType, { allowAttributes: 'resizedWidth' });
    editor.conversion.for('downcast').add(dispatcher =>
      dispatcher.on(`attribute:resizedWidth:${imageType}`, (evt: any, data: any, conversionApi: any) => {
        if (!conversionApi.consumable.consume(data.item, evt.name)) return;
        const viewWriter = conversionApi.writer;
        const figure = conversionApi.mapper.toViewElement(data.item);
        if (data.attributeNewValue !== null) {
          viewWriter.setStyle('width', data.attributeNewValue, figure);
          viewWriter.addClass('image_resized', figure);
        } else {
          viewWriter.removeStyle('width', figure);
          viewWriter.removeClass('image_resized', figure);
        }
      })
    );
    editor.conversion.for('upcast').attributeToAttribute({
      view: { name: imageType === 'imageBlock' ? 'figure' : 'img', styles: { width: /.+/ } },
      model: { key: 'resizedWidth', value: (viewElement: any) => (imageType === 'imageBlock' && !imageUtils.isBlockImageView(viewElement) ? null : viewElement.getStyle('width')) }
    });
  }
}

export class ImageResizeButtons extends Plugin {
  public static override get requires() {
    return [ImageResizeEditing];
  }

  public static override get pluginName(): string {
    return 'ImageResizeButtons';
  }

  public override init(): void {
    const editor = this.editor;
    const options = editor.config.get('image.resizeOptions') as ImageResizeOption[];
    const command = editor.commands.get('resizeImage')!;
    this.bind('isEnabled').to(command);
    for (const option of options) {
      this._registerImageResizeButton(option);
    }
    this._registerImageResizeDropdown(options);
  }

  private _registerImageResizeButton(option: ImageResizeOption): void {
    const editor = this.editor;
    const { name, value, icon } = option;
    const optionValueWithUnit = value ? value + (editor.config.get('image.resizeUnit') as string) : null;
    editor.ui.componentFactory.add(name, locale => {
      const button = new ButtonView(locale);
      const command = editor.commands.get('resizeImage')!;
      const labelText = this._getOptionLabelValue(option, true);
      const iconMap: Record<string, string> = { small: icons.objectSizeSmall, medium: icons.objectSizeMedium, large: icons.objectSizeLarge, original: icons.objectFullWidth };
      button.set({ label: labelText, icon: iconMap[icon || 'original'], tooltip: labelText, isToggleable: true });
      button.bind('isEnabled').to(this);
      button.bind('isOn').to(command, 'value', getIsOnButtonCallback(optionValueWithUnit));
      this.listenTo(button, 'execute', () => {
        editor.execute('resizeImage', { width: optionValueWithUnit });
      });
      return button;
    });
  }

  private _registerImageResizeDropdown(options: ImageResizeOption[]): void {
    const editor = this.editor;
    const t = editor.t;
    const originalSizeOption = options.find(option => !option.value)!;
    const componentCreator = (locale: any) => {
      const command = editor.commands.get('resizeImage')!;
      const dropdownView = createDropdown(locale);
      const dropdownButton = dropdownView.buttonView as any;
      dropdownButton.set({ tooltip: t('Resize image'), commandValue: originalSizeOption.value, icon: icons.objectSizeMedium, isToggleable: true, label: this._getOptionLabelValue(originalSizeOption), withText: true, class: 'ck-resize-image-button' });
      dropdownButton.bind('label').to(command, 'value', (commandValue: any) => {
        if (commandValue && commandValue.width) return commandValue.width;
        return this._getOptionLabelValue(originalSizeOption);
      });
      dropdownView.bind('isEnabled').to(this);
      addListToDropdown(dropdownView, () => this._getResizeDropdownListItemDefinitions(options, command), { ariaLabel: t('Image resize list') });
      this.listenTo(dropdownView, 'execute', (evt: any) => {
        editor.execute(evt.source.commandName, { width: evt.source.commandValue });
        editor.editing.view.focus();
      });
      return dropdownView;
    };
    editor.ui.componentFactory.add('resizeImage', componentCreator);
    editor.ui.componentFactory.add('imageResize', componentCreator);
  }

  private _getOptionLabelValue(option: ImageResizeOption, forTooltip = false): string {
    const t = this.editor.t;
    if (option.label) return option.label;
    if (forTooltip) {
      if (option.value) return t('Resize image to %0', option.value + (this.editor.config.get('image.resizeUnit') as string));
      return t('Resize image to the original size');
    }
    if (option.value) return option.value + (this.editor.config.get('image.resizeUnit') as string);
    return t('Original');
  }

  private _getResizeDropdownListItemDefinitions(options: ImageResizeOption[], command: Command): Collection<ListDropdownItemDefinition> {
    const resizeUnit = this.editor.config.get('image.resizeUnit') as string;
    const itemDefinitions = new Collection<ListDropdownItemDefinition>();
    options.forEach(option => {
      const optionValueWithUnit = option.value ? option.value + resizeUnit : null;
      const definition: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
      definition.model!.set({ commandName: 'resizeImage', commandValue: optionValueWithUnit, label: this._getOptionLabelValue(option), withText: true, icon: null } as any);
      definition.model!.bind('isOn').to(command, 'value', getIsOnButtonCallback(optionValueWithUnit));
      itemDefinitions.add(definition);
    });
    return itemDefinitions;
  }
}

function getIsOnButtonCallback(value: string | null) {
  return (commandValue: any) => {
    const objectCommandValue = commandValue as null | { width: string | null };
    if (value === null && objectCommandValue === value) return true;
    return objectCommandValue !== null && objectCommandValue.width === value;
  };
}

export class ImageResize extends Plugin {
  public static override get requires() {
    return [ImageResizeEditing, ImageResizeButtons];
  }

  public static override get pluginName(): string {
    return 'ImageResize';
  }
}
