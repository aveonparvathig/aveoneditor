import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ImageUtils } from './imageutils';
import { Widget } from '../widget/widget';
import { ClipboardPipeline } from '../clipboard/clipboard';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { EventInfo } from '../../utils/eventinfo';
import type { DowncastAttributeEvent, DowncastConversionApi } from '../../engine/conversion/downcastdispatcher';
import type { UpcastConversionApi, UpcastConversionData } from '../../engine/conversion/upcastdispatcher';

/** Inserts images from the given sources (URLs or `{src, alt}` objects). */
export class InsertImageCommand extends Command {
  public override refresh(): void {
    const imageUtils = this.editor.plugins.get('ImageUtils') as ImageUtils;
    this.isEnabled = imageUtils.isImageAllowed();
  }

  public override execute(options: { source: string | Array<string | Record<string, unknown>> | Record<string, unknown>; imageType?: 'imageBlock' | 'imageInline' }): void {
    const sourceDefinitions = Array.isArray(options.source) ? options.source : [options.source];
    const selection = this.editor.model.document.selection;
    const imageUtils = this.editor.plugins.get('ImageUtils') as ImageUtils;
    const selectionAttributes = Object.fromEntries(selection.getAttributes());
    sourceDefinitions.forEach((sourceDefinition, index) => {
      const selectedElement = selection.getSelectedElement();
      if (typeof sourceDefinition === 'string') {
        sourceDefinition = { src: sourceDefinition };
      }
      if (index && selectedElement && imageUtils.isImage(selectedElement)) {
        const position = this.editor.model.createPositionAfter(selectedElement);
        imageUtils.insertImage({ ...(sourceDefinition as Record<string, unknown>), ...selectionAttributes }, position, options.imageType || null);
      } else {
        imageUtils.insertImage({ ...(sourceDefinition as Record<string, unknown>), ...selectionAttributes }, null, options.imageType || null);
      }
    });
  }
}

/** Converts a block image to an inline one or vice versa. */
export class ImageTypeCommand extends Command {
  private readonly _modelElementName: 'imageBlock' | 'imageInline';

  constructor(editor: Editor, modelElementName: 'imageBlock' | 'imageInline') {
    super(editor);
    this._modelElementName = modelElementName;
  }

  public override refresh(): void {
    const editor = this.editor;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const element = imageUtils.getClosestSelectedImageElement(this.editor.model.document.selection);
    if (this._modelElementName === 'imageBlock') {
      this.isEnabled = imageUtils.isInlineImage(element);
    } else {
      this.isEnabled = imageUtils.isBlockImage(element);
    }
  }

  public override execute(): { oldElement: ModelElement; newElement: ModelElement } | null {
    const editor = this.editor;
    const model = this.editor.model;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const oldElement = imageUtils.getClosestSelectedImageElement(model.document.selection)!;
    const attributes = Object.fromEntries(oldElement.getAttributes());
    if (!attributes.src && !attributes.uploadId) return null;
    return model.change(writer => {
      const markers = Array.from(model.markers).filter(marker => marker.getRange().containsItem(oldElement));
      void markers;
      const newElement = imageUtils.insertImage(attributes, model.createSelection(oldElement, 'on'), this._modelElementName);
      if (!newElement) return null;
      return { oldElement, newElement };
    });
  }
}

/** Block image editing: schema, converters and commands. */
export class ImageBlockEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils, ClipboardPipeline];
  }

  public static override get pluginName(): string {
    return 'ImageBlockEditing';
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    schema.register('imageBlock', { inheritAllFrom: '$blockObject', allowAttributes: ['alt', 'src', 'srcset', 'width', 'height'] });
    this._setupConversion();
    editor.commands.add('insertImage', new InsertImageCommand(editor));
    editor.commands.add('imageInsert', editor.commands.get('insertImage')!);
    if (editor.plugins.has('ImageInlineEditing')) {
      editor.commands.add('imageTypeBlock', new ImageTypeCommand(editor, 'imageBlock'));
    }
  }

  private _setupConversion(): void {
    const editor = this.editor;
    const t = editor.t;
    const conversion = editor.conversion;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;

    conversion.for('dataDowncast').elementToStructure({
      model: 'imageBlock',
      view: (modelElement, { writer }) => {
        const figure = writer.createContainerElement('figure', { class: 'image' });
        const img = writer.createEmptyElement('img');
        writer.insert(writer.createPositionAt(figure, 0), img);
        writer.insert(writer.createPositionAt(figure, 'end'), writer.createSlot());
        return figure;
      }
    });
    conversion.for('editingDowncast').elementToStructure({
      model: 'imageBlock',
      view: (modelElement, { writer }) => {
        const figure = writer.createContainerElement('figure', { class: 'image' });
        const img = writer.createEmptyElement('img');
        writer.insert(writer.createPositionAt(figure, 0), img);
        writer.insert(writer.createPositionAt(figure, 'end'), writer.createSlot());
        return imageUtils.toImageWidget(figure, writer, t('image widget'));
      }
    });
    conversion.for('downcast').add(downcastImageAttribute(imageUtils, 'imageBlock', 'src')).add(downcastImageAttribute(imageUtils, 'imageBlock', 'alt')).add(downcastImageAttribute(imageUtils, 'imageBlock', 'srcset')).add(downcastImageAttribute(imageUtils, 'imageBlock', 'width')).add(downcastImageAttribute(imageUtils, 'imageBlock', 'height'));

    conversion.for('upcast').add(dispatcher => dispatcher.on('element:figure', upcastImageFigure(imageUtils)));
    conversion.for('upcast').elementToElement({
      view: (element: any) => (imageUtils.isInlineImageView(element) && element.findAncestor((el: any) => imageUtils.isBlockImageView(el)) ? { name: true } : null),
      model: (viewImage, { writer }) => writer.createElement('imageBlock', getImgAttributes(viewImage))
    });
  }
}

/** Inline image editing. */
export class ImageInlineEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils, ClipboardPipeline];
  }

  public static override get pluginName(): string {
    return 'ImageInlineEditing';
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    schema.register('imageInline', { inheritAllFrom: '$inlineObject', allowAttributes: ['alt', 'src', 'srcset', 'width', 'height'] });
    schema.addChildCheck((context, childDefinition) => {
      if (context.endsWith('caption') && childDefinition.name === 'imageInline') return false;
      return undefined;
    });
    this._setupConversion();
    if (editor.plugins.has('ImageBlockEditing')) {
      editor.commands.add('imageTypeInline', new ImageTypeCommand(editor, 'imageInline'));
    } else {
      editor.commands.add('insertImage', new InsertImageCommand(editor));
      editor.commands.add('imageInsert', editor.commands.get('insertImage')!);
    }
  }

  private _setupConversion(): void {
    const editor = this.editor;
    const t = editor.t;
    const conversion = editor.conversion;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;

    conversion.for('dataDowncast').elementToElement({
      model: 'imageInline',
      view: (modelElement, { writer }) => writer.createEmptyElement('img')
    });
    conversion.for('editingDowncast').elementToStructure({
      model: 'imageInline',
      view: (modelElement, { writer }) => {
        const span = writer.createContainerElement('span', { class: 'image-inline' });
        const img = writer.createEmptyElement('img');
        writer.insert(writer.createPositionAt(span, 0), img);
        return imageUtils.toImageWidget(span, writer, t('image widget'));
      }
    });
    conversion.for('downcast').add(downcastImageAttribute(imageUtils, 'imageInline', 'src')).add(downcastImageAttribute(imageUtils, 'imageInline', 'alt')).add(downcastImageAttribute(imageUtils, 'imageInline', 'srcset')).add(downcastImageAttribute(imageUtils, 'imageInline', 'width')).add(downcastImageAttribute(imageUtils, 'imageInline', 'height'));

    conversion.for('upcast').elementToElement({
      view: (element: any) => (imageUtils.isInlineImageView(element) && !element.findAncestor((el: any) => imageUtils.isBlockImageView(el)) ? { name: true } : null),
      model: (viewImage, { writer }) => writer.createElement('imageInline', getImgAttributes(viewImage))
    });
  }
}

function getImgAttributes(viewImage: ViewElement): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const name of ['src', 'alt', 'srcset', 'width', 'height']) {
    if (viewImage.hasAttribute(name)) attributes[name] = viewImage.getAttribute(name);
  }
  return attributes;
}

function downcastImageAttribute(imageUtils: ImageUtils, imageType: string, attributeKey: string) {
  return (dispatcher: any) => {
    dispatcher.on(`attribute:${attributeKey}:${imageType}`, (evt: EventInfo, data: DowncastAttributeEvent, conversionApi: DowncastConversionApi) => {
      if (!conversionApi.consumable.consume(data.item as any, evt.name)) return;
      const viewWriter = conversionApi.writer;
      const element = conversionApi.mapper.toViewElement(data.item as ModelElement) as ViewElement;
      const img = imageUtils.findViewImgElement(element);
      if (!img) return;
      if (data.attributeNewValue !== null && data.attributeNewValue !== undefined) {
        viewWriter.setAttribute(attributeKey, data.attributeNewValue as string, img);
      } else {
        viewWriter.removeAttribute(attributeKey, img);
      }
    });
  };
}

function upcastImageFigure(imageUtils: ImageUtils) {
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi) => {
    const viewFigure = data.viewItem as ViewElement;
    if (!conversionApi.consumable.test(viewFigure as any, { name: true, classes: 'image' })) return;
    const viewImage = imageUtils.findViewImgElement(viewFigure);
    if (!viewImage || !viewImage.hasAttribute('src') || !conversionApi.consumable.test(viewImage as any, { name: true })) return;
    conversionApi.consumable.consume(viewFigure as any, { name: true, classes: 'image' });
    const conversionResult = conversionApi.convertItem(viewImage, data.modelCursor);
    const modelImage = conversionResult.modelRange ? (conversionResult.modelRange.start.nodeAfter as ModelElement | null) : null;
    if (!modelImage) {
      conversionApi.consumable.revert(viewFigure as any, { name: true, classes: 'image' });
      return;
    }
    conversionApi.convertChildren(viewFigure, modelImage);
    conversionApi.updateConversionResult(modelImage, data);
  };
}

/** Image feature core: block and inline images. */
export class ImageEditing extends Plugin {
  public static override get requires() {
    return [ImageUtils, Widget, ImageBlockEditing, ImageInlineEditing];
  }

  public static override get pluginName(): string {
    return 'ImageEditing';
  }
}
