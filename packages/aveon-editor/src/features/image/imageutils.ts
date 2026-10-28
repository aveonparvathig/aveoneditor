import { Plugin } from '../../core/plugin';
import { toWidget, isWidget, findOptimalInsertionRange } from '../widget/utils';
import { first } from '../../utils/misc';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { DowncastWriter } from '../../engine/view/downcastwriter';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import type { DocumentSelection as ViewDocumentSelection } from '../../engine/view/documentselection';
import type { Selection as ViewSelection } from '../../engine/view/selection';

/** Helpers shared by the image features. */
export class ImageUtils extends Plugin {
  public static override get pluginName(): string {
    return 'ImageUtils';
  }

  public isImage(modelElement: any): boolean {
    return this.isInlineImage(modelElement) || this.isBlockImage(modelElement);
  }

  public isInlineImageView(element: any): boolean {
    return !!element && element.is && element.is('element', 'img');
  }

  public isBlockImageView(element: any): boolean {
    return !!element && element.is && element.is('element', 'figure') && element.hasClass('image');
  }

  public insertImage(attributes: Record<string, unknown> = {}, selectable: any = null, imageType: 'imageBlock' | 'imageInline' | null = null, options: { setImageSizes?: boolean } = {}): ModelElement | null {
    const editor = this.editor;
    const model = editor.model;
    const selection = model.document.selection;
    const determinedImageType = determineImageTypeForInsertion(editor, selectable || selection, imageType);
    attributes = { ...Object.fromEntries(selection.getAttributes()), ...attributes };
    for (const attributeName in attributes) {
      if (!model.schema.checkAttribute(determinedImageType, attributeName)) {
        delete attributes[attributeName];
      }
    }
    void options;
    return model.change(writer => {
      const imageElement = writer.createElement(determinedImageType, attributes);
      model.insertObject(imageElement, selectable, null, { setSelection: 'on', findOptimalPosition: !this.isInlineImage(imageElement) ? 'auto' : undefined });
      if (imageElement.parent) {
        return imageElement;
      }
      return null;
    });
  }

  public getClosestSelectedImageWidget(selection: ViewSelection | ViewDocumentSelection): ViewElement | null {
    const selectionPosition = selection.getFirstPosition();
    if (!selectionPosition) return null;
    const viewElement = selection.getSelectedElement();
    if (viewElement && this.isImageWidget(viewElement)) return viewElement;
    let parent: any = selectionPosition.parent;
    while (parent) {
      if (parent.is('element') && this.isImageWidget(parent)) return parent;
      parent = parent.parent;
    }
    return null;
  }

  public getClosestSelectedImageElement(selection: Selection | DocumentSelection): ModelElement | null {
    const selectedElement = selection.getSelectedElement();
    return this.isImage(selectedElement) ? selectedElement : (selection.getFirstPosition()!.findAncestor('imageBlock') as ModelElement | null);
  }

  public isImageAllowed(): boolean {
    const model = this.editor.model;
    const selection = model.document.selection;
    return isImageAllowedInParent(this.editor, selection) && isNotInsideImage(selection);
  }

  public toImageWidget(viewElement: ViewElement, writer: DowncastWriter, label: string): ViewElement {
    writer.setCustomProperty('image', true, viewElement);
    const labelCreator = () => {
      const imgElement = this.findViewImgElement(viewElement);
      const altText = imgElement ? imgElement.getAttribute('alt') : null;
      return altText ? `${altText} ${label}` : label;
    };
    return toWidget(viewElement, writer, { label: labelCreator });
  }

  public isImageWidget(viewElement: ViewElement): boolean {
    return !!viewElement.getCustomProperty('image') && isWidget(viewElement);
  }

  public isBlockImage(modelElement: any): boolean {
    return !!modelElement && modelElement.is && modelElement.is('element', 'imageBlock');
  }

  public isInlineImage(modelElement: any): boolean {
    return !!modelElement && modelElement.is && modelElement.is('element', 'imageInline');
  }

  public findViewImgElement(figureView: ViewElement): ViewElement | undefined {
    if (this.isInlineImageView(figureView)) return figureView;
    for (const child of figureView.getChildren()) {
      if ((child as any).is('element', 'img')) return child as ViewElement;
      if ((child as any).is('element') && !(child as any).is('uiElement')) {
        const found = this.findViewImgElement(child as ViewElement);
        if (found) return found;
      }
    }
    return undefined;
  }
}

function isImageAllowedInParent(editor: any, selection: any): boolean {
  const imageType = determineImageTypeForInsertion(editor, selection, null);
  if (imageType === 'imageBlock') {
    const parent = getInsertImageParent(selection, editor.model);
    if (editor.model.schema.checkChild(parent, 'imageBlock')) return true;
  } else if (editor.model.schema.checkChild(selection.focus, 'imageInline')) {
    return true;
  }
  return false;
}

function isNotInsideImage(selection: any): boolean {
  return [...selection.focus.getAncestors()].every((ancestor: any) => !ancestor.is('element', 'imageBlock'));
}

function getInsertImageParent(selection: any, model: any): any {
  const insertionRange = findOptimalInsertionRange(selection, model);
  const parent = insertionRange.start.parent;
  if (parent.isEmpty && !parent.is('element', '$root')) return parent.parent;
  return parent;
}

function determineImageTypeForInsertion(editor: any, selectable: any, imageType: 'imageBlock' | 'imageInline' | null): 'imageBlock' | 'imageInline' {
  const schema = editor.model.schema;
  const configImageInsertType = editor.config.get('image.insert.type');
  if (!editor.plugins.has('ImageBlockEditing')) return 'imageInline';
  if (!editor.plugins.has('ImageInlineEditing')) return 'imageBlock';
  if (imageType) return imageType;
  if (configImageInsertType === 'inline') return 'imageInline';
  if (configImageInsertType === 'block') return 'imageBlock';
  if (selectable.is && selectable.is('selection')) {
    return determineImageTypeForInsertionAtSelection(schema, selectable);
  }
  return schema.checkChild(selectable, 'imageInline') ? 'imageInline' : 'imageBlock';
}

export function determineImageTypeForInsertionAtSelection(schema: any, selection: any): 'imageBlock' | 'imageInline' {
  const firstBlock = first(selection.getSelectedBlocks()) as ModelElement | null;
  if (!firstBlock || schema.isObject(firstBlock)) return 'imageBlock';
  if (firstBlock.isEmpty && firstBlock.name !== 'listItem') return 'imageBlock';
  return 'imageInline';
}
