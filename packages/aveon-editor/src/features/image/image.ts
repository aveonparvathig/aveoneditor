import { Plugin } from '../../core/plugin';
import { ImageEditing, ImageBlockEditing, ImageInlineEditing } from './imageediting';
import { ImageTextAlternative } from './imagetextalternative';
import { ImageInsertUI } from './imageinsert';
import { ImageUtils } from './imageutils';
import { Widget } from '../widget/widget';
import { WidgetToolbarRepository } from '../widget/widgettoolbarrepository';
import type { Editor } from '../../core/editor';

export class ImageBlock extends Plugin {
  public static override get requires() {
    return [ImageBlockEditing, Widget, ImageTextAlternative, ImageInsertUI];
  }

  public static override get pluginName(): string {
    return 'ImageBlock';
  }
}

export class ImageInline extends Plugin {
  public static override get requires() {
    return [ImageInlineEditing, Widget, ImageTextAlternative, ImageInsertUI];
  }

  public static override get pluginName(): string {
    return 'ImageInline';
  }
}

/** The image feature (block and inline images, text alternative, insert UI). */
export class Image extends Plugin {
  public static override get requires() {
    return [ImageBlock, ImageInline, ImageEditing];
  }

  public static override get pluginName(): string {
    return 'Image';
  }
}

/** Contextual toolbar for images (`config.image.toolbar`). */
export class ImageToolbar extends Plugin {
  public static override get requires() {
    return [WidgetToolbarRepository, ImageUtils];
  }

  public static override get pluginName(): string {
    return 'ImageToolbar';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('image.toolbar', ['imageTextAlternative', 'toggleImageCaption', '|', 'imageStyle:inline', 'imageStyle:block', 'imageStyle:side']);
  }

  public override afterInit(): void {
    const editor = this.editor;
    const t = editor.t;
    const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository) as WidgetToolbarRepository;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    widgetToolbarRepository.register('image', {
      ariaLabel: t('Image toolbar'),
      items: normalizeItems(editor.config.get('image.toolbar') as any[], editor),
      getRelatedElement: selection => imageUtils.getClosestSelectedImageWidget(selection)
    });
  }
}

function normalizeItems(items: any[], editor: Editor): string[] {
  const available = new Set(editor.ui.componentFactory.names());
  return items.filter(item => typeof item !== 'string' || item === '|' || available.has(item.toLowerCase()) || Array.from(available).some(name => name.toLowerCase() === item.toLowerCase()));
}

export { ImageEditing, ImageBlockEditing, ImageInlineEditing, ImageUtils };
export { InsertImageCommand, ImageTypeCommand } from './imageediting';
export { ImageCaption, ImageCaptionEditing, ImageCaptionUI, ToggleImageCaptionCommand } from './imagecaption';
export { ImageStyle, ImageStyleEditing, ImageStyleUI, ImageStyleCommand } from './imagestyle';
export { ImageTextAlternative, ImageTextAlternativeEditing, ImageTextAlternativeUI, ImageTextAlternativeCommand } from './imagetextalternative';
export { ImageUpload, ImageUploadEditing, ImageUploadUI, ImageUploadProgress, UploadImageCommand, FileRepository, FileLoader, Base64UploadAdapter, SimpleUploadAdapter, FileDialogButtonView } from './imageupload';
export type { UploadAdapter } from './imageupload';
export { ImageInsert, ImageInsertUI, ImageInsertViaUrl, ImageInsertUrlView } from './imageinsert';
export { ImageResize, ImageResizeEditing, ImageResizeButtons, ResizeImageCommand } from './imageresize';
