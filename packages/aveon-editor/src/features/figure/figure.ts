/**
 * Figure tools: resize handles, crop, drag-to-move, alignment and captions for images, sketches,
 * diagrams and any other block object that registers with `FigureEditing`.
 */

import { Plugin } from '../../core/plugin';
import { FigureEditing } from './figureediting';
import { FigureUI } from './figureui';
import { WidgetResize } from '../widget/widgetresize';
import { WidgetDrag } from '../widget/widgetdrag';

export class Figure extends Plugin {
  public static override get pluginName(): string {
    return 'Figure';
  }

  public static override get requires() {
    return [FigureEditing, FigureUI, WidgetResize, WidgetDrag];
  }
}

export { FigureEditing } from './figureediting';
export type { FigureRegistration } from './figureediting';
export { FigureUI, ResizeFigureCommand, FigureAlignCommand, ToggleFigureCaptionCommand, CropFigureCommand, MoveFigureCommand } from './figureui';
export { openCropDialog } from './cropdialog';
export type { CropRect, CropDialogOptions } from './cropdialog';
export { getSelectedFigure, toFigureWidget, isFigureWidget, getClosestFigureWidget, FIGURE_ALIGN_CLASSES } from './figureutils';
export type { FigureAlign, SelectedFigure } from './figureutils';
