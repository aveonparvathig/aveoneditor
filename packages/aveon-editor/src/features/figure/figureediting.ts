/**
 * Gives block objects other than images (sketches, diagrams…) the same model as a block image:
 * a `resizedWidth` (`"50%"` → `style="width:50%"`), a `figureAlign` (`left | center | right | side`,
 * the `image-style-*` classes) and a nested `caption` element (`<figcaption>`). A feature calls
 * `register()` once its model element exists; the generic commands in `FigureUI` then work on it.
 */

import { Plugin } from '../../core/plugin';
import { toWidgetEditable } from '../widget/utils';
import { enablePlaceholder } from '../../engine/view/placeholder';
import { FIGURE_ALIGN_CLASSES, alignFromClasses, type FigureAlign } from './figureutils';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';

export const RESIZED_CLASS = 'figure_resized';

export interface FigureRegistration {
  /** Class of the figure in the data (`<figure class="sketch">`), used to accept its caption. */
  viewClass: string;
  /** Crops the figure in place (opens whatever UI it needs); absent when it cannot be cropped. */
  crop?: (editor: Editor, element: ModelElement) => Promise<void>;
}

export class FigureEditing extends Plugin {
  private readonly _figures = new Map<string, FigureRegistration>();

  public static override get pluginName(): string {
    return 'FigureEditing';
  }

  /** Model names of the registered figures. */
  public get names(): string[] {
    return [...this._figures.keys()];
  }

  public get(name: string): FigureRegistration | undefined {
    return this._figures.get(name);
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    if (!schema.isRegistered('caption')) {
      schema.register('caption', { allowContentOf: '$block', isLimit: true });
    }
    this._setUpCaptionConversion();
  }

  /** Decorates `name` (an already registered block object) with width, alignment and a caption. */
  public register(name: string, registration: FigureRegistration): void {
    if (this._figures.has(name)) return;
    this._figures.set(name, registration);
    const editor = this.editor;
    const schema = editor.model.schema;
    schema.extend(name, { allowAttributes: ['resizedWidth', 'figureAlign'] });
    schema.extend('caption', { allowIn: name });

    editor.conversion.for('downcast').add(dispatcher => {
      dispatcher.on(`attribute:resizedWidth:${name}`, (evt: any, data: any, conversionApi: any) => {
        if (!conversionApi.consumable.consume(data.item, evt.name)) return;
        const figure = conversionApi.mapper.toViewElement(data.item) as ViewElement;
        const writer = conversionApi.writer;
        if (!figure) return;
        if (data.attributeNewValue) {
          writer.setStyle('width', String(data.attributeNewValue), figure);
          writer.addClass(RESIZED_CLASS, figure);
        } else {
          writer.removeStyle('width', figure);
          writer.removeClass(RESIZED_CLASS, figure);
        }
      });
    });
    editor.conversion.for('downcast').attributeToAttribute({
      model: { key: 'figureAlign', name },
      view: (value: unknown) => {
        const className = FIGURE_ALIGN_CLASSES[value as FigureAlign];
        return className ? { key: 'class', value: className } : null;
      }
    });
  }

  /**
   * The width and alignment a stored `<figure>` carries, for a feature's own upcast converter
   * (the figure converters consume the whole element, so attribute converters do not see it).
   */
  public readAttributes(viewFigure: ViewElement): { resizedWidth?: string; figureAlign?: FigureAlign } {
    const attributes: { resizedWidth?: string; figureAlign?: FigureAlign } = {};
    const width = viewFigure.getStyle('width');
    if (width && /^\d+(\.\d+)?(%|px)$/.test(width)) attributes.resizedWidth = width;
    const align = alignFromClasses(viewFigure);
    if (align) attributes.figureAlign = align;
    return attributes;
  }

  private _setUpCaptionConversion(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const t = editor.t;
    const isFigureParent = (element: any) => !!element && element.is('element') && this._figures.has(element.name);
    const isFigureView = (element: any) => {
      if (!element || !element.is('element', 'figure')) return false;
      for (const registration of this._figures.values()) {
        if (element.hasClass(registration.viewClass)) return true;
      }
      return false;
    };

    editor.conversion.for('upcast').elementToElement({
      view: (element: any) => (element.is('element', 'figcaption') && isFigureView(element.parent) ? { name: true } : null),
      model: 'caption'
    });
    editor.conversion.for('dataDowncast').elementToElement({
      model: 'caption',
      view: (modelElement: ModelElement, { writer }: any) => (isFigureParent(modelElement.parent) ? writer.createContainerElement('figcaption') : null)
    });
    editor.conversion.for('editingDowncast').elementToElement({
      model: 'caption',
      view: (modelElement: ModelElement, { writer }: any) => {
        if (!isFigureParent(modelElement.parent)) return null;
        const figcaption = writer.createEditableElement('figcaption');
        writer.setCustomProperty('figureCaption', true, figcaption);
        figcaption.placeholder = t('Enter caption');
        enablePlaceholder({ view, element: figcaption, text: t('Enter caption'), keepOnFocus: true });
        return toWidgetEditable(figcaption, writer, { label: t('Caption') });
      }
    });
  }
}
