import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { ImageUtils } from './imageutils';
import { toWidgetEditable } from '../widget/utils';
import { enablePlaceholder } from '../../engine/view/placeholder';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

/** Adds or removes the caption of the selected block image. */
export class ToggleImageCaptionCommand extends Command {
  private _savedCaptionsMap = new WeakMap<ModelElement, Record<string, unknown>>();

  public override refresh(): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const selection = editor.model.document.selection;
    const selectedElement = selection.getSelectedElement();
    if (!selectedElement) {
      const ancestorCaptionElement = getCaptionFromModelSelection(selection);
      this.isEnabled = !!ancestorCaptionElement;
      this.value = !!ancestorCaptionElement;
      return;
    }
    this.isEnabled = imageUtils.isImage(selectedElement);
    if (!this.isEnabled) {
      this.value = false;
    } else {
      this.value = !!getCaptionFromImageModelElement(selectedElement);
    }
  }

  public override execute(options: { focusCaptionOnShow?: boolean } = {}): void {
    const { focusCaptionOnShow } = options;
    this.editor.model.change(writer => {
      if (this.value) {
        this._hideImageCaption(writer);
      } else {
        this._showImageCaption(writer, !!focusCaptionOnShow);
      }
    });
  }

  private _showImageCaption(writer: any, focusCaptionOnShow: boolean): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const imageUtils = this.editor.plugins.get('ImageUtils') as ImageUtils;
    let selectedImage = selection.getSelectedElement()!;
    if (imageUtils.isInlineImage(selectedImage)) {
      this.editor.execute('imageTypeBlock');
      selectedImage = selection.getSelectedElement()!;
    }
    const savedCaption = this._savedCaptionsMap.get(selectedImage);
    const newCaptionElement = savedCaption ? deserializeCaption(writer, savedCaption) : writer.createElement('caption');
    writer.append(newCaptionElement, selectedImage);
    if (focusCaptionOnShow) {
      writer.setSelection(newCaptionElement, 'in');
    }
  }

  private _hideImageCaption(writer: any): void {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    let selectedImage = selection.getSelectedElement();
    let captionElement: ModelElement | null;
    if (selectedImage) {
      captionElement = getCaptionFromImageModelElement(selectedImage);
    } else {
      captionElement = getCaptionFromModelSelection(selection);
      selectedImage = captionElement!.parent as ModelElement;
    }
    if (!captionElement) return;
    this._savedCaptionsMap.set(selectedImage, captionElement.toJSON());
    writer.setSelection(selectedImage, 'on');
    writer.remove(captionElement);
  }
}

function deserializeCaption(writer: any, json: any): ModelElement {
  const caption = writer.createElement('caption', json.attributes);
  for (const child of json.children || []) {
    if (child.name) {
      caption._appendChild(deserializeCaption(writer, child));
    } else {
      caption._appendChild(writer.createText(child.data, child.attributes));
    }
  }
  return caption;
}

export function getCaptionFromImageModelElement(imageModelElement: ModelElement): ModelElement | null {
  for (const node of imageModelElement.getChildren()) {
    if ((node as any).is('element', 'caption')) return node as ModelElement;
  }
  return null;
}

export function getCaptionFromModelSelection(selection: any): ModelElement | null {
  const captionElement = selection.getFirstPosition().findAncestor('caption');
  if (!captionElement) return null;
  const imageUtilsParent = captionElement.parent;
  if (imageUtilsParent && imageUtilsParent.is('element', 'imageBlock')) return captionElement;
  return null;
}

export class ImageCaptionEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils];
  }

  public static override get pluginName(): string {
    return 'ImageCaptionEditing';
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    if (!schema.isRegistered('caption')) {
      schema.register('caption', { allowIn: 'imageBlock', allowContentOf: '$block', isLimit: true });
    } else {
      schema.extend('caption', { allowIn: 'imageBlock' });
    }
    editor.commands.add('toggleImageCaption', new ToggleImageCaptionCommand(this.editor));
    this._setupConversion();
  }

  private _setupConversion(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const t = editor.t;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;

    editor.conversion.for('upcast').elementToElement({
      view: (element: any) => {
        if (!element.is('element', 'figcaption')) return null;
        const parent = element.parent;
        if (parent && imageUtils.isBlockImageView(parent)) return { name: true };
        return null;
      },
      model: 'caption'
    });
    editor.conversion.for('dataDowncast').elementToElement({ model: 'caption', view: (modelElement, { writer }) => (imageUtils.isBlockImage(modelElement.parent) ? writer.createContainerElement('figcaption') : null) });
    editor.conversion.for('editingDowncast').elementToElement({
      model: 'caption',
      view: (modelElement, { writer }) => {
        if (!imageUtils.isBlockImage(modelElement.parent)) return null;
        const figcaptionElement = writer.createEditableElement('figcaption');
        writer.setCustomProperty('imageCaption', true, figcaptionElement);
        figcaptionElement.placeholder = t('Enter image caption');
        enablePlaceholder({ view, element: figcaptionElement, text: t('Enter image caption'), keepOnFocus: true });
        return toWidgetEditable(figcaptionElement, writer, { label: t('Image caption') });
      }
    });
  }
}

export class ImageCaptionUI extends Plugin {
  public static override get requires() {
    return [ImageCaptionEditing];
  }

  public static override get pluginName(): string {
    return 'ImageCaptionUI';
  }

  public override init(): void {
    const editor = this.editor;
    const editingView = editor.editing.view;
    const t = editor.t;
    editor.ui.componentFactory.add('toggleImageCaption', locale => {
      const command = editor.commands.get('toggleImageCaption')!;
      const view = new ButtonView(locale);
      view.set({ icon: icons.caption, tooltip: true, isToggleable: true });
      view.bind('isOn', 'isEnabled').to(command, 'value', 'isEnabled');
      view.bind('label').to(command, 'value', (value: unknown) => (value ? t('Toggle caption off') : t('Toggle caption on')));
      this.listenTo(view, 'execute', () => {
        editor.execute('toggleImageCaption', { focusCaptionOnShow: true });
        const modelCaptionElement = getCaptionFromModelSelection(editor.model.document.selection);
        if (modelCaptionElement) {
          const figcaptionElement = editor.editing.mapper.toViewElement(modelCaptionElement) as ViewElement;
          editingView.scrollToTheSelection();
          editingView.change(writer => {
            writer.addClass('image__caption_highlighted', figcaptionElement);
          });
        }
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class ImageCaption extends Plugin {
  public static override get requires() {
    return [ImageCaptionEditing, ImageCaptionUI];
  }

  public static override get pluginName(): string {
    return 'ImageCaption';
  }
}

export type { Editor };
