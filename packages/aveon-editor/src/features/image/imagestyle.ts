import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { ImageUtils } from './imageutils';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';

export interface ImageStyleOptionDefinition {
  name: string;
  title: string;
  icon: string;
  className?: string;
  modelElements: Array<'imageBlock' | 'imageInline'>;
  isDefault?: boolean;
}

export const DEFAULT_OPTIONS: Record<string, ImageStyleOptionDefinition> = {
  inline: { name: 'inline', title: 'In line', icon: icons.objectInline, modelElements: ['imageInline'], isDefault: true },
  alignLeft: { name: 'alignLeft', title: 'Left aligned image', icon: icons.objectLeft, modelElements: ['imageBlock', 'imageInline'], className: 'image-style-align-left' },
  alignBlockLeft: { name: 'alignBlockLeft', title: 'Left aligned image', icon: icons.objectLeft, modelElements: ['imageBlock'], className: 'image-style-block-align-left' },
  alignCenter: { name: 'alignCenter', title: 'Centered image', icon: icons.objectCenter, modelElements: ['imageBlock'], className: 'image-style-align-center' },
  alignRight: { name: 'alignRight', title: 'Right aligned image', icon: icons.objectRight, modelElements: ['imageBlock', 'imageInline'], className: 'image-style-align-right' },
  alignBlockRight: { name: 'alignBlockRight', title: 'Right aligned image', icon: icons.objectRight, modelElements: ['imageBlock'], className: 'image-style-block-align-right' },
  block: { name: 'block', title: 'Centered image', icon: icons.objectCenter, modelElements: ['imageBlock'], isDefault: true },
  side: { name: 'side', title: 'Side image', icon: icons.objectRight, modelElements: ['imageBlock'], className: 'image-style-side' }
};

/** Applies an image style (alignment / inline / block) to the selected image. */
export class ImageStyleCommand extends Command {
  private _defaultStyles: Record<string, string | false> = { imageBlock: false, imageInline: false };
  private _styles: Map<string, ImageStyleOptionDefinition>;

  constructor(editor: Editor, styles: ImageStyleOptionDefinition[]) {
    super(editor);
    this._styles = new Map(styles.map(style => {
      if (style.isDefault) {
        for (const modelElementName of style.modelElements) {
          this._defaultStyles[modelElementName] = style.name;
        }
      }
      return [style.name, style];
    }));
  }

  public override refresh(): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const element = imageUtils.getClosestSelectedImageElement(this.editor.model.document.selection);
    this.isEnabled = !!element;
    if (!this.isEnabled) {
      this.value = false;
    } else if (element!.hasAttribute('imageStyle')) {
      this.value = element!.getAttribute('imageStyle');
    } else {
      this.value = this._defaultStyles[element!.name];
    }
  }

  public override execute(options: { value: string; setImageSizes?: boolean } = { value: '' }): void {
    const editor = this.editor;
    const model = editor.model;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    model.change(writer => {
      const requestedStyle = options.value;
      let imageElement = imageUtils.getClosestSelectedImageElement(model.document.selection)!;
      if (requestedStyle && this.shouldConvertImageType(requestedStyle, imageElement)) {
        const result = this.editor.execute(imageUtils.isBlockImage(imageElement) ? 'imageTypeInline' : 'imageTypeBlock') as { newElement: ModelElement } | null;
        if (result) imageElement = result.newElement;
      }
      if (!requestedStyle || this._styles.get(requestedStyle)!.isDefault) {
        writer.removeAttribute('imageStyle', imageElement);
      } else {
        writer.setAttribute('imageStyle', requestedStyle, imageElement);
      }
    });
  }

  public shouldConvertImageType(requestedStyle: string, imageElement: ModelElement): boolean {
    const supportedTypes = this._styles.get(requestedStyle)!.modelElements;
    return !supportedTypes.includes(imageElement.name as any);
  }
}

export class ImageStyleEditing extends Plugin {
  public normalizedStyles: ImageStyleOptionDefinition[] = [];

  public static override get pluginName(): string {
    return 'ImageStyleEditing';
  }

  public static override get requires() {
    return [ImageUtils];
  }

  public override init(): void {
    const editor = this.editor;
    const isBlockPluginLoaded = editor.plugins.has('ImageBlockEditing');
    const isInlinePluginLoaded = editor.plugins.has('ImageInlineEditing');
    const defaults = isBlockPluginLoaded && isInlinePluginLoaded ? ['inline', 'alignLeft', 'alignRight', 'alignCenter', 'alignBlockLeft', 'alignBlockRight', 'block', 'side'] : isBlockPluginLoaded ? ['block', 'side'] : ['inline', 'alignLeft', 'alignRight'];
    editor.config.define('image.styles', { options: defaults });
    const options = editor.config.get('image.styles.options') as Array<string | ImageStyleOptionDefinition>;
    this.normalizedStyles = options
      .map(option => (typeof option === 'string' ? DEFAULT_OPTIONS[option] : { ...(DEFAULT_OPTIONS[option.name] || {}), ...option }))
      .filter((o): o is ImageStyleOptionDefinition => !!o && !!o.name)
      .filter(o => o.modelElements.every(name => (name === 'imageBlock' ? isBlockPluginLoaded : isInlinePluginLoaded)));
    this._setupConversion(isBlockPluginLoaded, isInlinePluginLoaded);
    editor.commands.add('imageStyle', new ImageStyleCommand(editor, this.normalizedStyles));
  }

  private _setupConversion(isBlockPluginLoaded: boolean, isInlinePluginLoaded: boolean): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const styles = this.normalizedStyles;
    const downcastConverter = (modelAttributeValue: unknown) => {
      const style = styles.find(s => s.name === modelAttributeValue);
      if (!style || !style.className) return null;
      return { key: 'class', value: style.className };
    };
    if (isBlockPluginLoaded) {
      schema.extend('imageBlock', { allowAttributes: 'imageStyle' });
      editor.conversion.for('downcast').attributeToAttribute({ model: { key: 'imageStyle', name: 'imageBlock' }, view: downcastConverter });
      editor.conversion.for('upcast').attributeToAttribute({
        view: { name: 'figure', key: 'class', value: /image-style-[a-z-]+/ },
        model: { key: 'imageStyle', value: (viewElement: any) => getStyleFromClasses(styles, viewElement, 'imageBlock') }
      });
    }
    if (isInlinePluginLoaded) {
      schema.extend('imageInline', { allowAttributes: 'imageStyle' });
      editor.conversion.for('downcast').attributeToAttribute({ model: { key: 'imageStyle', name: 'imageInline' }, view: downcastConverter });
      editor.conversion.for('upcast').attributeToAttribute({
        view: { name: 'img', key: 'class', value: /image-style-[a-z-]+/ },
        model: { key: 'imageStyle', value: (viewElement: any) => getStyleFromClasses(styles, viewElement, 'imageInline') }
      });
    }
  }
}

function getStyleFromClasses(styles: ImageStyleOptionDefinition[], viewElement: any, modelElementName: string): string | null {
  for (const style of styles) {
    if (style.className && viewElement.hasClass(style.className) && style.modelElements.includes(modelElementName as any)) {
      return style.name;
    }
  }
  return null;
}

export class ImageStyleUI extends Plugin {
  public static override get requires() {
    return [ImageStyleEditing];
  }

  public static override get pluginName(): string {
    return 'ImageStyleUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const styles = (editor.plugins.get('ImageStyleEditing') as ImageStyleEditing).normalizedStyles;
    const localized: Record<string, string> = { 'Centered image': t('Centered image'), 'Side image': t('Side image'), 'In line': t('In line'), 'Left aligned image': t('Left aligned image'), 'Right aligned image': t('Right aligned image'), 'Full size image': t('Full size image') };
    for (const style of styles) {
      this._createButton({ ...style, title: localized[style.title] || style.title });
    }
  }

  private _createButton(buttonConfig: ImageStyleOptionDefinition): void {
    const editor = this.editor;
    const buttonName = buttonConfig.name;
    editor.ui.componentFactory.add(`imageStyle:${buttonName}`, locale => {
      const command = editor.commands.get('imageStyle')!;
      const view = new ButtonView(locale);
      view.set({ label: buttonConfig.title, icon: buttonConfig.icon, tooltip: true, isToggleable: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      view.bind('isOn').to(command, 'value', (value: unknown) => value === buttonName);
      view.on('execute', () => {
        editor.execute('imageStyle', { value: buttonName });
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class ImageStyle extends Plugin {
  public static override get requires() {
    return [ImageStyleEditing, ImageStyleUI];
  }

  public static override get pluginName(): string {
    return 'ImageStyle';
  }
}
