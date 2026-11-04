/**
 * One set of commands and buttons for every figure (images, sketches, diagrams…): size, alignment,
 * caption, crop and keyboard moving. On an image the commands hand over to the image feature's own
 * commands (`resizeImage`, `imageStyle`, `toggleImageCaption`), so the Picture tab and the balloon
 * toolbar can show the same buttons whatever is selected.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import { WidgetToolbarRepository } from '../widget/widgettoolbarrepository';
import { FigureEditing } from './figureediting';
import { getSelectedFigure, getClosestFigureWidget, FIGURE_ALIGN_CLASSES, type FigureAlign, type SelectedFigure } from './figureutils';
import { openCropDialog, type CropRect } from './cropdialog';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';

const IMAGE_STYLE_OF: Record<FigureAlign, string> = { left: 'alignLeft', center: 'alignCenter', right: 'alignRight', side: 'side' };
const ALIGN_OF_IMAGE_STYLE: Record<string, FigureAlign> = { alignLeft: 'left', alignBlockLeft: 'left', alignCenter: 'center', alignRight: 'right', alignBlockRight: 'right', side: 'side' };

function figureNames(editor: Editor): string[] {
  return (editor.plugins.get('FigureEditing') as FigureEditing).names;
}

abstract class FigureCommand extends Command {
  protected get figure(): SelectedFigure | null {
    return getSelectedFigure(this.editor, figureNames(this.editor));
  }
}

/** `{ width: '50%' | null }`: the figure's width as a share of the editing area. */
export class ResizeFigureCommand extends FigureCommand {
  declare public value: { width: string | null } | null;

  public override refresh(): void {
    const figure = this.figure;
    if (!figure) {
      this.isEnabled = false;
      this.value = null;
      return;
    }
    if (figure.isImage) {
      const command = this.editor.commands.get('resizeImage');
      this.isEnabled = !!command && command.isEnabled;
      this.value = command ? ((command as any).value as { width: string | null }) || { width: null } : null;
      return;
    }
    this.isEnabled = true;
    this.value = { width: (figure.element.getAttribute('resizedWidth') as string | undefined) || null };
  }

  public override execute(options: { width: string | null }): void {
    const figure = this.figure;
    if (!figure) return;
    if (figure.isImage) {
      this.editor.execute('resizeImage', { width: options.width });
      return;
    }
    this.editor.model.change(writer => {
      if (options.width) writer.setAttribute('resizedWidth', options.width, figure.element);
      else writer.removeAttribute('resizedWidth', figure.element);
    });
  }
}

/** `{ value: 'left' | 'center' | 'right' | 'side' }`; the same value again clears the alignment. */
export class FigureAlignCommand extends FigureCommand {
  declare public value: FigureAlign | null;

  public override refresh(): void {
    const figure = this.figure;
    if (!figure) {
      this.isEnabled = false;
      this.value = null;
      return;
    }
    if (figure.isImage) {
      const command = this.editor.commands.get('imageStyle');
      this.isEnabled = !!command && command.isEnabled;
      const style = command ? ((command as any).value as string | false) : false;
      this.value = style ? ALIGN_OF_IMAGE_STYLE[style] || null : null;
      return;
    }
    this.isEnabled = true;
    this.value = (figure.element.getAttribute('figureAlign') as FigureAlign | undefined) || null;
  }

  public override execute(options: { value: FigureAlign | null }): void {
    const figure = this.figure;
    if (!figure) return;
    const value = options.value && options.value !== this.value ? options.value : null;
    if (figure.isImage) {
      const fallback = figure.element.name === 'imageInline' ? 'inline' : 'block';
      this.editor.execute('imageStyle', { value: value ? IMAGE_STYLE_OF[value] : fallback });
      return;
    }
    this.editor.model.change(writer => {
      if (value) writer.setAttribute('figureAlign', value, figure.element);
      else writer.removeAttribute('figureAlign', figure.element);
    });
  }
}

/** Shows or hides the figure's caption; the hidden text comes back when the caption is shown again. */
export class ToggleFigureCaptionCommand extends FigureCommand {
  declare public value: boolean;
  private readonly _savedCaptions = new WeakMap<ModelElement, unknown>();

  public override refresh(): void {
    const figure = this.figure;
    if (!figure) {
      this.isEnabled = false;
      this.value = false;
      return;
    }
    if (figure.isImage) {
      const command = this.editor.commands.get('toggleImageCaption');
      this.isEnabled = !!command && command.isEnabled;
      this.value = !!command && !!(command as any).value;
      return;
    }
    this.isEnabled = true;
    this.value = !!captionOf(figure.element);
  }

  public override execute(options: { focusCaptionOnShow?: boolean } = {}): void {
    const figure = this.figure;
    if (!figure) return;
    if (figure.isImage) {
      this.editor.execute('toggleImageCaption', options);
      return;
    }
    const editor = this.editor;
    const element = figure.element;
    editor.model.change(writer => {
      const existing = captionOf(element);
      if (existing) {
        this._savedCaptions.set(element, existing.toJSON());
        writer.setSelection(element, 'on');
        writer.remove(existing);
        return;
      }
      const saved = this._savedCaptions.get(element) as any;
      const caption = saved ? deserialize(writer, saved) : writer.createElement('caption');
      writer.append(caption, element);
      if (options.focusCaptionOnShow) writer.setSelection(caption, 'in');
    });
  }
}

/** Crops the selected image or sketch through the crop dialog. */
export class CropFigureCommand extends FigureCommand {
  public override refresh(): void {
    const figure = this.figure;
    if (!figure) {
      this.isEnabled = false;
      return;
    }
    if (figure.isImage) {
      this.isEnabled = !!figure.element.getAttribute('src') && !figure.element.getAttribute('uploadId');
      return;
    }
    const registration = (this.editor.plugins.get('FigureEditing') as FigureEditing).get(figure.element.name);
    this.isEnabled = !!registration && !!registration.crop;
  }

  public override async execute(): Promise<void> {
    const figure = this.figure;
    if (!figure) return;
    if (figure.isImage) {
      await cropImage(this.editor, figure.element);
      return;
    }
    const registration = (this.editor.plugins.get('FigureEditing') as FigureEditing).get(figure.element.name);
    if (registration && registration.crop) await registration.crop(this.editor, figure.element);
  }
}

/** `{ direction: 'up' | 'down' }`: moves the selected block object past its neighbour. */
export class MoveFigureCommand extends Command {
  public override refresh(): void {
    const selected = this.editor.model.document.selection.getSelectedElement();
    this.isEnabled = !!selected && this.editor.model.schema.isBlock(selected) && this.editor.model.schema.isObject(selected);
  }

  public override execute(options: { direction: 'up' | 'down' }): void {
    const model = this.editor.model;
    const selected = model.document.selection.getSelectedElement() as ModelElement | null;
    if (!selected) return;
    const sibling = options.direction === 'up' ? selected.previousSibling : selected.nextSibling;
    if (!sibling) return;
    model.change(writer => {
      const range = writer.createRangeOn(selected);
      writer.move(range, options.direction === 'up' ? writer.createPositionBefore(sibling) : writer.createPositionAfter(sibling));
      writer.setSelection(selected, 'on');
    });
    this.editor.editing.view.scrollToTheSelection();
  }
}

function captionOf(element: ModelElement): ModelElement | null {
  for (const child of element.getChildren()) {
    if ((child as any).is('element', 'caption')) return child as ModelElement;
  }
  return null;
}

function deserialize(writer: any, json: any): ModelElement {
  const element = writer.createElement(json.name || 'caption', json.attributes);
  for (const child of json.children || []) {
    if (child.name) writer.append(deserialize(writer, child), element);
    else writer.append(writer.createText(child.data, child.attributes), element);
  }
  return element;
}

/** Loads a picture for drawing on a canvas; `tainted` means it came from another origin. */
function loadPicture(src: string): Promise<{ image: HTMLImageElement; tainted: boolean }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!/^(data|blob):/.test(src)) image.crossOrigin = 'anonymous';
    image.onload = () => {
      let tainted = false;
      try {
        const probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        const context = probe.getContext('2d');
        context?.drawImage(image, 0, 0, 1, 1);
        context?.getImageData(0, 0, 1, 1);
      } catch {
        tainted = true;
      }
      resolve({ image, tainted });
    };
    image.onerror = () => reject(new Error('figure-crop-load: the image could not be loaded.'));
    image.src = src;
  });
}

async function cropImage(editor: Editor, element: ModelElement): Promise<void> {
  const t = editor.t;
  const src = String(element.getAttribute('src') || '');
  if (!src) return;
  const { image, tainted } = await loadPicture(src);
  const rect = await openCropDialog(editor, {
    src,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    title: t('Crop image'),
    error: tainted ? t('This image comes from another site and cannot be cropped here. Upload it first.') : undefined
  });
  if (!rect) return;
  const newSrc = await cropToSource(editor, image, rect);
  editor.model.change(writer => {
    writer.setAttribute('src', newSrc, element);
    writer.removeAttribute('srcset', element);
    if (element.hasAttribute('width')) writer.setAttribute('width', rect.width, element);
    if (element.hasAttribute('height')) writer.setAttribute('height', rect.height, element);
    writer.setSelection(element, 'on');
  });
}

/** Draws the rectangle to a canvas and uploads it like a dropped file (a data URL without an adapter). */
async function cropToSource(editor: Editor, image: HTMLImageElement, rect: CropRect): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('figure-crop-canvas: no 2D context.');
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const type = /\.jpe?g($|\?)/i.test(image.src) || /^data:image\/jpeg/i.test(image.src) ? 'image/jpeg' : 'image/png';
  const repository: any = editor.plugins.has('FileRepository') ? editor.plugins.get('FileRepository') : null;
  if (repository && repository.createUploadAdapter && typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92));
    if (blob) {
      const file = new File([blob], `cropped.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type });
      const loader = repository.createLoader(file);
      if (loader) {
        try {
          const result = await loader.upload();
          return result.default;
        } finally {
          repository.destroyLoader(loader);
        }
      }
    }
  }
  return canvas.toDataURL(type, 0.92);
}

export class FigureUI extends Plugin {
  public static override get pluginName(): string {
    return 'FigureUI';
  }

  public static override get requires() {
    return [FigureEditing, WidgetToolbarRepository];
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('figure.toolbar', ['toggleFigureCaption', '|', 'figureAlign:left', 'figureAlign:center', 'figureAlign:right', '|', 'resizeFigure', 'cropFigure']);
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.commands.add('resizeFigure', new ResizeFigureCommand(editor));
    editor.commands.add('figureAlign', new FigureAlignCommand(editor));
    editor.commands.add('toggleFigureCaption', new ToggleFigureCaptionCommand(editor));
    editor.commands.add('cropFigure', new CropFigureCommand(editor));
    editor.commands.add('moveFigure', new MoveFigureCommand(editor));

    this._addAlignButtons();
    this._addResizeDropdown();
    this._addButton('toggleFigureCaption', t('Caption'), icons.caption, () => editor.execute('toggleFigureCaption', { focusCaptionOnShow: true }), true);
    this._addButton('cropFigure', t('Crop'), icons.crop, () => void editor.execute('cropFigure'));

    editor.keystrokes.set('Alt+Shift+ArrowUp', (data, cancel) => {
      if (!editor.commands.get('moveFigure')!.isEnabled) return;
      editor.execute('moveFigure', { direction: 'up' });
      cancel();
    });
    editor.keystrokes.set('Alt+Shift+ArrowDown', (data, cancel) => {
      if (!editor.commands.get('moveFigure')!.isEnabled) return;
      editor.execute('moveFigure', { direction: 'down' });
      cancel();
    });
  }

  public override afterInit(): void {
    const editor = this.editor;
    const t = editor.t;
    const repository = editor.plugins.get(WidgetToolbarRepository) as WidgetToolbarRepository;
    const available = new Set(editor.ui.componentFactory.names());
    const items = (editor.config.get('figure.toolbar') as string[]).filter(item => item === '|' || available.has(item));
    repository.register('figure', {
      ariaLabel: t('Figure toolbar'),
      items,
      getRelatedElement: selection => getClosestFigureWidget(selection)
    });
  }

  private _addButton(name: string, label: string, icon: string, run: () => void, toggleable = false): void {
    const editor = this.editor;
    editor.ui.componentFactory.add(name, locale => {
      const command = editor.commands.get(name)!;
      const button = new ButtonView(locale);
      button.set({ label, icon, tooltip: true, isToggleable: toggleable });
      button.bind('isEnabled').to(command, 'isEnabled');
      if (toggleable) button.bind('isOn').to(command, 'value', (value: unknown) => !!value);
      this.listenTo(button, 'execute', () => {
        run();
        editor.editing.view.focus();
      });
      return button;
    });
  }

  private _addAlignButtons(): void {
    const editor = this.editor;
    const t = editor.t;
    const labels: Record<FigureAlign, string> = { left: t('Align left'), center: t('Center'), right: t('Align right'), side: t('Side image') };
    const buttonIcons: Record<FigureAlign, string> = { left: icons.objectLeft, center: icons.objectCenter, right: icons.objectRight, side: icons.objectInline };
    for (const align of Object.keys(FIGURE_ALIGN_CLASSES) as FigureAlign[]) {
      editor.ui.componentFactory.add(`figureAlign:${align}`, locale => {
        const command = editor.commands.get('figureAlign')!;
        const button = new ButtonView(locale);
        button.set({ label: labels[align], icon: buttonIcons[align], tooltip: true, isToggleable: true });
        button.bind('isEnabled').to(command, 'isEnabled');
        button.bind('isOn').to(command, 'value', (value: unknown) => value === align);
        this.listenTo(button, 'execute', () => {
          editor.execute('figureAlign', { value: align });
          editor.editing.view.focus();
        });
        return button;
      });
    }
  }

  private _addResizeDropdown(): void {
    const editor = this.editor;
    const t = editor.t;
    const options: Array<{ label: string; value: string | null }> = [
      { label: t('Original'), value: null },
      { label: '25%', value: '25%' },
      { label: '50%', value: '50%' },
      { label: '75%', value: '75%' },
      { label: '100%', value: '100%' }
    ];
    editor.ui.componentFactory.add('resizeFigure', locale => {
      const command = editor.commands.get('resizeFigure')!;
      const dropdown = createDropdown(locale);
      dropdown.buttonView.set({ label: t('Resize'), icon: icons.objectSizeMedium, tooltip: t('Resize'), withText: false });
      dropdown.bind('isEnabled').to(command, 'isEnabled');
      const definitions = new Collection<ListDropdownItemDefinition>();
      for (const option of options) {
        const definition: ListDropdownItemDefinition = { type: 'button', model: new Observable() as any };
        definition.model!.set({ label: option.label, withText: true, role: 'menuitemradio', resizeValue: option.value } as any);
        definition.model!.bind('isOn').to(command, 'value', (value: unknown) => {
          const width = value ? (value as { width: string | null }).width : null;
          return (width || null) === option.value;
        });
        definitions.add(definition);
      }
      addListToDropdown(dropdown, definitions);
      this.listenTo(dropdown, 'execute', (evt: any) => {
        editor.execute('resizeFigure', { width: (evt.source as any).resizeValue ?? null });
        editor.editing.view.focus();
      });
      return dropdown;
    });
  }
}
