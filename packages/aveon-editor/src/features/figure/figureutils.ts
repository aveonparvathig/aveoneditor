/**
 * Shared pieces of the figure tools: which block objects count as figures, how the selection finds
 * one, and the widget wrapper that gives a figure its drag grip and resize handles.
 */

import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { DowncastWriter } from '../../engine/view/downcastwriter';
import type { DocumentSelection as ViewDocumentSelection } from '../../engine/view/documentselection';
import { toWidget, isWidget, addResizeHandles } from '../widget/utils';

export type FigureAlign = 'left' | 'center' | 'right' | 'side';

/** Alignment → the class names the image feature already styles (`theme/index.css`). */
export const FIGURE_ALIGN_CLASSES: Record<FigureAlign, string> = {
  left: 'image-style-align-left',
  center: 'image-style-align-center',
  right: 'image-style-align-right',
  side: 'image-style-side'
};

export const IMAGE_NAMES = ['imageBlock', 'imageInline'];

export interface SelectedFigure {
  element: ModelElement;
  /** An image (block or inline): the image feature's own commands do the work. */
  isImage: boolean;
}

/** The alignment a view figure's classes express, if any. */
export function alignFromClasses(viewElement: ViewElement): FigureAlign | null {
  for (const align of Object.keys(FIGURE_ALIGN_CLASSES) as FigureAlign[]) {
    if (viewElement.hasClass(FIGURE_ALIGN_CLASSES[align])) return align;
  }
  return null;
}

/** The figure the selection is on, or inside (its caption counts): an image or one of `names`. */
export function getSelectedFigure(editor: Editor, names: Iterable<string>): SelectedFigure | null {
  const selection = editor.model.document.selection;
  const all = new Set([...IMAGE_NAMES, ...names]);
  let element = selection.getSelectedElement() as ModelElement | null;
  if (!element || !all.has(element.name)) {
    element = null;
    const position = selection.getFirstPosition();
    let parent: any = position ? position.parent : null;
    while (parent) {
      if (parent.is && parent.is('element') && all.has(parent.name)) {
        element = parent as ModelElement;
        break;
      }
      parent = parent.parent;
    }
  }
  if (!element) return null;
  return { element, isImage: IMAGE_NAMES.includes(element.name) };
}

/** Makes a view figure the widget of a sketch, diagram or other registered figure. */
export function toFigureWidget(viewElement: ViewElement, writer: DowncastWriter, options: { label: string | (() => string); resizable?: boolean }): ViewElement {
  writer.setCustomProperty('figure', true, viewElement);
  const widget = toWidget(viewElement, writer, { label: options.label, hasSelectionHandle: true });
  if (options.resizable !== false) addResizeHandles(viewElement, writer);
  return widget;
}

export function isFigureWidget(viewElement: ViewElement | null | undefined): boolean {
  return !!viewElement && !!viewElement.getCustomProperty('figure') && isWidget(viewElement);
}

/** The selected figure widget, or the one around the selection (a caption being edited). */
export function getClosestFigureWidget(selection: ViewDocumentSelection): ViewElement | null {
  const selected = selection.getSelectedElement();
  if (selected && isFigureWidget(selected)) return selected;
  const position = selection.getFirstPosition();
  let parent: any = position ? position.parent : null;
  while (parent) {
    if (parent.is && parent.is('element') && isFigureWidget(parent)) return parent;
    parent = parent.parent;
  }
  return null;
}
