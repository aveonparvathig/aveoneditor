import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { Observable } from '../../utils/observable';
import { Collection } from '../../utils/collection';
import { ButtonView } from '../../ui/button/buttonview';
import { View } from '../../ui/view';
import { icons } from '../../ui/icons';
import { ImageUtils } from './imageutils';
import { ClipboardPipeline } from '../clipboard/clipboard';
import { Notification } from '../../ui/notification';
import { PendingActions } from '../../core/pendingactions';
import { uid } from '../../utils/uid';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { Locale } from '../../utils/locale';

export interface UploadAdapter {
  upload(): Promise<Record<string, string>>;
  abort?(): void;
}

/** A single file upload: observable `status`, `uploadedPercent`, `uploadResponse`. */
export class FileLoader extends Observable {
  public readonly id = uid();
  public readonly file: Promise<File | null>;
  declare public status: 'idle' | 'reading' | 'uploading' | 'aborted' | 'error';
  declare public uploaded: number;
  declare public uploadTotal: number | null;
  declare public uploadedPercent: number;
  declare public uploadResponse: Record<string, string> | null;
  declare public data: string | undefined;
  private _adapter: UploadAdapter;
  private _reader: FileReader | null = null;

  constructor(filePromise: Promise<File | null>, uploadAdapterCreator: (loader: FileLoader) => UploadAdapter) {
    super();
    this.file = filePromise;
    this._adapter = uploadAdapterCreator(this);
    this.set('status', 'idle');
    this.set('uploaded', 0);
    this.set('uploadTotal', null);
    this.bind('uploadedPercent').to(this, 'uploaded', this, 'uploadTotal', (uploaded: number, total: number | null) => (total ? (uploaded / total) * 100 : 0));
    this.set('uploadResponse', null);
    this.set('data', undefined);
  }

  public read(): Promise<string> {
    if (this.status !== 'idle') throw new Error('filerepository-read-wrong-status');
    this.status = 'reading';
    return this.file.then(file => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        this._reader = reader;
        reader.onload = () => {
          this.status = 'idle';
          this.data = reader.result as string;
          resolve(this.data);
        };
        reader.onerror = () => {
          this.status = 'error';
          reject(reader.error);
        };
        reader.onabort = () => {
          this.status = 'aborted';
          reject();
        };
        reader.readAsDataURL(file!);
      });
    });
  }

  public upload(): Promise<Record<string, string>> {
    if (this.status !== 'idle') throw new Error('filerepository-upload-wrong-status');
    this.status = 'uploading';
    return this.file
      .then(() => this._adapter.upload())
      .then(data => {
        this.uploadResponse = data;
        this.status = 'idle';
        return data;
      })
      .catch(err => {
        if (this.status === 'aborted') throw new Error('aborted');
        this.status = 'error';
        throw err;
      });
  }

  public abort(): void {
    const status = this.status;
    this.status = 'aborted';
    if (status === 'reading' && this._reader) this._reader.abort();
    if (status === 'uploading' && this._adapter.abort) this._adapter.abort();
    this._destroy();
  }

  private _destroy(): void {
    this._reader = null;
    this.stopListening();
    this.fire('destroy' as any);
  }
}

/** Repository of file loaders; features register an upload adapter via `createUploadAdapter`. */
export class FileRepository extends Plugin {
  public readonly loaders = new Collection<FileLoader>();
  public createUploadAdapter?: (loader: FileLoader) => UploadAdapter;
  private _loadersMap = new Map<File | Promise<File>, FileLoader>();
  private _pendingAction: any = null;
  declare public uploaded: number;
  declare public uploadTotal: number | null;
  declare public uploadedPercent: number;

  public static override get pluginName(): string {
    return 'FileRepository';
  }

  public static override get requires() {
    return [PendingActions];
  }

  public override init(): void {
    this.loaders.on('change', () => this._updatePendingAction());
    this.set('uploaded', 0);
    this.set('uploadTotal', null);
    this.bind('uploadedPercent').to(this, 'uploaded', this, 'uploadTotal', (uploaded: number, total: number | null) => (total ? (uploaded / total) * 100 : 0));
  }

  public getLoader(fileOrPromise: File | Promise<File>): FileLoader | null {
    return this._loadersMap.get(fileOrPromise) || null;
  }

  public createLoader(fileOrPromise: File | Promise<File>): FileLoader | null {
    if (!this.createUploadAdapter) {
      console.warn('filerepository-no-upload-adapter: Upload adapter is not defined.');
      return null;
    }
    const loader = new FileLoader(Promise.resolve(fileOrPromise), this.createUploadAdapter);
    this.loaders.add(loader);
    this._loadersMap.set(fileOrPromise, loader);
    loader.on('change:uploaded', () => {
      let aggregatedUploaded = 0;
      for (const loader of this.loaders) aggregatedUploaded += loader.uploaded;
      this.uploaded = aggregatedUploaded;
    });
    loader.on('change:uploadTotal', () => {
      let aggregatedTotal = 0;
      for (const loader of this.loaders) {
        if (loader.uploadTotal) aggregatedTotal += loader.uploadTotal;
      }
      this.uploadTotal = aggregatedTotal;
    });
    return loader;
  }

  public destroyLoader(fileOrPromiseOrLoader: File | Promise<File> | FileLoader): void {
    const loader = fileOrPromiseOrLoader instanceof FileLoader ? fileOrPromiseOrLoader : this.getLoader(fileOrPromiseOrLoader)!;
    if (!loader) return;
    if (this.loaders.has(loader)) this.loaders.remove(loader);
    this._loadersMap.forEach((value, key) => {
      if (value === loader) this._loadersMap.delete(key);
    });
  }

  private _updatePendingAction(): void {
    const pendingActions = this.editor.plugins.get(PendingActions) as PendingActions;
    if (this.loaders.length) {
      if (!this._pendingAction) {
        const t = this.editor.t;
        const getMessage = (value: number) => `${t('Upload in progress')} ${parseInt(String(value), 10)}%.`;
        this._pendingAction = pendingActions.add(getMessage(this.uploadedPercent));
        this._pendingAction.bind('message').to(this, 'uploadedPercent', getMessage);
      }
    } else {
      pendingActions.remove(this._pendingAction);
      this._pendingAction = null;
    }
  }
}

/** Upload adapter that embeds files as Base64 data URLs (no server needed). */
export class Base64UploadAdapter extends Plugin {
  public static override get requires() {
    return [FileRepository];
  }

  public static override get pluginName(): string {
    return 'Base64UploadAdapter';
  }

  public override init(): void {
    (this.editor.plugins.get(FileRepository) as FileRepository).createUploadAdapter = loader => new Adapter(loader);
  }
}

class Adapter implements UploadAdapter {
  private _loader: FileLoader;
  private _reader: FileReader | null = null;

  constructor(loader: FileLoader) {
    this._loader = loader;
  }

  public upload(): Promise<Record<string, string>> {
    return new Promise((resolve, reject) => {
      const reader = (this._reader = new FileReader());
      reader.addEventListener('load', () => resolve({ default: reader.result as string }));
      reader.addEventListener('error', err => reject(err));
      reader.addEventListener('abort', () => reject());
      this._loader.file.then(file => reader.readAsDataURL(file!));
    });
  }

  public abort(): void {
    if (this._reader) this._reader.abort();
  }
}

/** Simple upload adapter posting files to a server endpoint (`config.simpleUpload.uploadUrl`). */
export class SimpleUploadAdapter extends Plugin {
  public static override get requires() {
    return [FileRepository];
  }

  public static override get pluginName(): string {
    return 'SimpleUploadAdapter';
  }

  public override init(): void {
    const options = this.editor.config.get('simpleUpload') as { uploadUrl?: string; headers?: Record<string, string>; withCredentials?: boolean } | undefined;
    if (!options || !options.uploadUrl) {
      console.warn('simple-upload-adapter-missing-uploadurl: config.simpleUpload.uploadUrl is not set.');
      return;
    }
    (this.editor.plugins.get(FileRepository) as FileRepository).createUploadAdapter = loader => new SimpleAdapter(loader, options as any);
  }
}

class SimpleAdapter implements UploadAdapter {
  private _loader: FileLoader;
  private _options: { uploadUrl: string; headers?: Record<string, string>; withCredentials?: boolean };
  private _xhr: XMLHttpRequest | null = null;

  constructor(loader: FileLoader, options: { uploadUrl: string; headers?: Record<string, string>; withCredentials?: boolean }) {
    this._loader = loader;
    this._options = options;
  }

  public upload(): Promise<Record<string, string>> {
    return this._loader.file.then(file => new Promise((resolve, reject) => {
      const xhr = (this._xhr = new XMLHttpRequest());
      xhr.open('POST', this._options.uploadUrl, true);
      xhr.responseType = 'json';
      xhr.withCredentials = !!this._options.withCredentials;
      for (const [key, value] of Object.entries(this._options.headers || {})) xhr.setRequestHeader(key, value);
      const genericErrorText = `Couldn't upload file: ${file!.name}.`;
      xhr.addEventListener('error', () => reject(genericErrorText));
      xhr.addEventListener('abort', () => reject());
      xhr.addEventListener('load', () => {
        const response = xhr.response;
        if (!response || response.error) {
          return reject(response && response.error && response.error.message ? response.error.message : genericErrorText);
        }
        const urls = response.url ? { default: response.url } : response.urls;
        resolve(urls);
      });
      if (xhr.upload) {
        xhr.upload.addEventListener('progress', evt => {
          if (evt.lengthComputable) {
            this._loader.uploadTotal = evt.total;
            this._loader.uploaded = evt.loaded;
          }
        });
      }
      const data = new FormData();
      data.append('upload', file!);
      xhr.send(data);
    }));
  }

  public abort(): void {
    if (this._xhr) this._xhr.abort();
  }
}

/** Uploads files and inserts them as images. */
export class UploadImageCommand extends Command {
  public override refresh(): void {
    const imageUtils = this.editor.plugins.get('ImageUtils') as ImageUtils;
    this.isEnabled = imageUtils.isImageAllowed();
  }

  public override execute(options: { file: File | File[] }): void {
    const files = Array.isArray(options.file) ? options.file : [options.file];
    const selection = this.editor.model.document.selection;
    const imageUtils = this.editor.plugins.get('ImageUtils') as ImageUtils;
    const selectionAttributes = Object.fromEntries(selection.getAttributes());
    files.forEach((file, index) => {
      const selectedElement = selection.getSelectedElement();
      if (index && selectedElement && imageUtils.isImage(selectedElement)) {
        const position = this.editor.model.createPositionAfter(selectedElement);
        this._uploadImage(file, selectionAttributes, position);
      } else {
        this._uploadImage(file, selectionAttributes, null);
      }
    });
  }

  private _uploadImage(file: File, attributes: Record<string, unknown>, position: any): void {
    const editor = this.editor;
    const fileRepository = editor.plugins.get(FileRepository) as FileRepository;
    const loader = fileRepository.createLoader(file);
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    if (!loader) return;
    imageUtils.insertImage({ ...attributes, uploadId: loader.id }, position);
  }
}

export class ImageUploadEditing extends Plugin {
  private _uploadImageElements = new Map<string, ModelElement>();

  public static override get requires() {
    return [FileRepository, Notification, ClipboardPipeline, ImageUtils];
  }

  public static override get pluginName(): string {
    return 'ImageUploadEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('image', { upload: { types: ['jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff'] } });
  }

  public override init(): void {
    const editor = this.editor;
    const doc = editor.model.document;
    const conversion = editor.conversion;
    const fileRepository = editor.plugins.get(FileRepository) as FileRepository;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const clipboardPipeline = editor.plugins.get('ClipboardPipeline') as ClipboardPipeline;
    const imageTypes = createImageTypeRegExp(editor.config.get('image.upload.types') as string[]);
    const uploadImageCommand = new UploadImageCommand(editor);

    editor.commands.add('uploadImage', uploadImageCommand);
    editor.commands.add('imageUpload', uploadImageCommand);

    conversion.for('upcast').attributeToAttribute({ view: { name: 'img', key: 'uploadId' }, model: 'uploadId' });

    this.listenTo(editor.editing.view.document, 'clipboardInput', (evt, data: any) => {
      if (isHtmlIncluded(data.dataTransfer)) return;
      const images = Array.from(data.dataTransfer.files as File[]).filter(file => !!file && imageTypes.test(file.type));
      if (!images.length) return;
      evt.stop();
      editor.model.change(writer => {
        if (data.targetRanges) {
          writer.setSelection(data.targetRanges.map((viewRange: any) => editor.editing.mapper.toModelRange(viewRange)));
        }
        editor.execute('uploadImage', { file: images });
      });
    });

    this.listenTo(clipboardPipeline, 'inputTransformation', (evt, data: any) => {
      const fetchableImages = Array.from(editor.editing.view.createRangeIn(data.content))
        .map(value => value.item as ViewElement)
        .filter(viewElement => isLocalImage(imageUtils, viewElement) && !viewElement.getAttribute('uploadProcessed'))
        .map(viewElement => ({ promise: fetchLocalImage(viewElement), imageElement: viewElement }));
      if (!fetchableImages.length) return;
      const writer = editor.editing.view.domConverter && new (require_upcast_writer())(editor.editing.view.document);
      for (const fetchableImage of fetchableImages) {
        writer.setAttribute('uploadProcessed', true, fetchableImage.imageElement);
        const loader = fileRepository.createLoader(fetchableImage.promise);
        if (loader) {
          writer.setAttribute('src', '', fetchableImage.imageElement);
          writer.setAttribute('uploadId', loader.id, fetchableImage.imageElement);
        }
      }
    });

    editor.editing.view.document.on('dragover', (evt, data: any) => {
      data.preventDefault();
    });

    doc.on('change', () => {
      const changes = doc.differ.getChanges();
      const insertedImagesIds = new Set<string>();
      for (const entry of changes) {
        if (entry.type === 'insert' || entry.type === 'refresh') {
          const node = (entry as any).node as ModelElement;
          if (!node || !(node as any).is('element')) continue;
          const items = [node, ...Array.from(editor.model.createRangeIn(node).getItems())];
          for (const item of items) {
            if ((item as any).is('element') && imageUtils.isImage(item) && item.hasAttribute('uploadId')) {
              const uploadId = item.getAttribute('uploadId') as string;
              const loader = fileRepository.loaders.get(uploadId);
              if (loader && loader.status === 'idle' && !insertedImagesIds.has(uploadId)) {
                insertedImagesIds.add(uploadId);
                this._uploadImageElements.set(uploadId, item as ModelElement);
                this._readAndUpload(loader);
              }
            }
          }
        }
      }
    });

    this.on('uploadComplete', (evt, { imageElement, data }: any) => {
      const urls = data.urls ? data.urls : data;
      this.editor.model.change(writer => {
        writer.setAttribute('src', urls.default, imageElement);
        this._parseAndSetSrcsetAttributeOnImage(urls, imageElement, writer);
        imageUtils.isImage(imageElement);
      });
    }, { priority: 'low' });
  }

  public override afterInit(): void {
    const schema = this.editor.model.schema;
    if (this.editor.plugins.has('ImageBlockEditing')) {
      schema.extend('imageBlock', { allowAttributes: ['uploadId', 'uploadStatus'] });
    }
    if (this.editor.plugins.has('ImageInlineEditing')) {
      schema.extend('imageInline', { allowAttributes: ['uploadId', 'uploadStatus'] });
    }
  }

  protected _readAndUpload(loader: FileLoader): Promise<void> {
    const editor = this.editor;
    const model = editor.model;
    const t = editor.locale.t;
    const fileRepository = editor.plugins.get(FileRepository) as FileRepository;
    const notification = editor.plugins.get(Notification) as Notification;
    const imageUploadElements = this._uploadImageElements;

    model.enqueueChange({ isUndoable: false }, writer => {
      writer.setAttribute('uploadStatus', 'reading', imageUploadElements.get(loader.id)!);
    });

    return loader
      .read()
      .then(() => {
        const promise = loader.upload();
        const imageElement = imageUploadElements.get(loader.id)!;
        model.enqueueChange({ isUndoable: false }, writer => {
          writer.setAttribute('uploadStatus', 'uploading', imageElement);
        });
        return promise;
      })
      .then(data => {
        model.enqueueChange({ isUndoable: false }, writer => {
          const imageElement = imageUploadElements.get(loader.id)!;
          writer.setAttribute('uploadStatus', 'complete', imageElement);
          this.fire('uploadComplete', { data, imageElement });
        });
        clean();
      })
      .catch(error => {
        if (loader.status !== 'error' && loader.status !== 'aborted') throw error;
        if (loader.status === 'error' && error) {
          notification.showWarning(error, { title: t('Upload failed'), namespace: 'upload' });
        }
        model.enqueueChange({ isUndoable: false }, writer => {
          writer.remove(imageUploadElements.get(loader.id)!);
        });
        clean();
      });

    function clean() {
      model.enqueueChange({ isUndoable: false }, writer => {
        const imageElement = imageUploadElements.get(loader.id)!;
        writer.removeAttribute('uploadId', imageElement);
        writer.removeAttribute('uploadStatus', imageElement);
        imageUploadElements.delete(loader.id);
      });
      fileRepository.destroyLoader(loader);
    }
  }

  protected _parseAndSetSrcsetAttributeOnImage(data: Record<string, string>, image: ModelElement, writer: any): void {
    let maxWidth = 0;
    const srcsetAttribute = Object.keys(data)
      .filter(key => {
        const width = parseInt(key, 10);
        if (!isNaN(width)) {
          maxWidth = Math.max(maxWidth, width);
          return true;
        }
        return false;
      })
      .map(key => `${data[key]} ${key}w`)
      .join(', ');
    if (srcsetAttribute !== '') {
      writer.setAttribute('srcset', srcsetAttribute, image);
      if (!image.hasAttribute('width')) writer.setAttribute('width', maxWidth, image);
    }
  }
}

/** Upload progress: shows a loader / placeholder while uploading. */
export class ImageUploadProgress extends Plugin {
  public static override get pluginName(): string {
    return 'ImageUploadProgress';
  }

  public override init(): void {
    const editor = this.editor;
    if (editor.plugins.has('ImageBlockEditing')) {
      editor.editing.downcastDispatcher.on('attribute:uploadStatus:imageBlock', (...args: any[]) => this.uploadStatusChange(...(args as [any, any, any])));
    }
    if (editor.plugins.has('ImageInlineEditing')) {
      editor.editing.downcastDispatcher.on('attribute:uploadStatus:imageInline', (...args: any[]) => this.uploadStatusChange(...(args as [any, any, any])));
    }
  }

  public uploadStatusChange(evt: any, data: any, conversionApi: any): void {
    const editor = this.editor;
    const modelImage = data.item;
    const uploadId = modelImage.getAttribute('uploadId');
    if (!conversionApi.consumable.consume(data.item, evt.name)) return;
    const imageUtils = editor.plugins.get('ImageUtils') as ImageUtils;
    const fileRepository = editor.plugins.get(FileRepository) as FileRepository;
    const status = uploadId ? data.attributeNewValue : null;
    const viewFigure = editor.editing.mapper.toViewElement(modelImage) as ViewElement;
    const viewWriter = conversionApi.writer;
    if (status === 'reading') {
      viewWriter.addClass('ck-appear', viewFigure);
      viewWriter.addClass('ck-image-upload-placeholder', viewFigure);
      return;
    }
    if (status === 'uploading') {
      const loader = fileRepository.loaders.get(uploadId);
      viewWriter.addClass('ck-appear', viewFigure);
      viewWriter.removeClass('ck-image-upload-placeholder', viewFigure);
      if (loader && loader.data) {
        const viewImg = imageUtils.findViewImgElement(viewFigure);
        if (viewImg) viewWriter.setAttribute('src', loader.data, viewImg);
      }
      if (!viewFigure.getCustomProperty('uploadProgressBar')) {
        const progressBar = viewWriter.createUIElement('div', { class: 'ck-progress-bar' });
        viewWriter.setCustomProperty('uploadProgressBar', true, viewFigure);
        viewWriter.insert(viewWriter.createPositionAt(viewFigure, 'end'), progressBar);
      }
      return;
    }
    if (status === 'complete') {
      viewWriter.removeClass('ck-appear', viewFigure);
    }
    viewWriter.removeClass('ck-image-upload-placeholder', viewFigure);
  }
}

/** Button that opens the native file dialog. */
export class FileDialogButtonView extends ButtonView {
  public readonly fileInputView: FileInputView;
  declare public acceptedType: string;
  declare public allowMultipleFiles: boolean;

  constructor(locale?: Locale) {
    super(locale);
    this.set('acceptedType', '');
    this.set('allowMultipleFiles', false);
    this.fileInputView = new FileInputView(locale);
    this.fileInputView.bind('acceptedType').to(this);
    this.fileInputView.bind('allowMultipleFiles').to(this);
    this.fileInputView.delegate('done').to(this);
    this.on('execute', () => {
      this.fileInputView.open();
    });
    this.children.add(this.fileInputView);
  }
}

class FileInputView extends View {
  declare public acceptedType: string;
  declare public allowMultipleFiles: boolean;
  declare public element: HTMLInputElement | null;

  constructor(locale?: Locale) {
    super(locale);
    this.set('acceptedType', '');
    this.set('allowMultipleFiles', false);
    const bind = this.bindTemplate;
    this.setTemplate({
      tag: 'input',
      attributes: {
        class: ['ck-hidden'],
        type: 'file',
        tabindex: '-1',
        accept: bind.to('acceptedType'),
        multiple: bind.to('allowMultipleFiles')
      },
      on: {
        change: bind.to(() => {
          if (this.element && this.element.files && this.element.files.length) {
            this.fire('done', this.element.files);
          }
          this.element!.value = '';
        })
      }
    });
  }

  public open(): void {
    this.element!.click();
  }
}

export class ImageUploadUI extends Plugin {
  public static override get pluginName(): string {
    return 'ImageUploadUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    const componentCreator = (locale: Locale) => {
      const view = new FileDialogButtonView(locale);
      const command = editor.commands.get('uploadImage')!;
      const imageTypes = editor.config.get('image.upload.types') as string[];
      const imageTypesRegExp = createImageTypeRegExp(imageTypes);
      view.set({ acceptedType: imageTypes.map(type => `image/${type}`).join(','), allowMultipleFiles: true });
      view.set({ label: t('Insert image'), icon: icons.imageUpload, tooltip: true });
      view.bind('isEnabled').to(command);
      view.on('done', (evt, files: FileList) => {
        const imagesToUpload = Array.from(files).filter(file => imageTypesRegExp.test(file.type));
        if (imagesToUpload.length) {
          editor.execute('uploadImage', { file: imagesToUpload });
          editor.editing.view.focus();
        }
      });
      return view;
    };
    editor.ui.componentFactory.add('uploadImage', componentCreator);
    editor.ui.componentFactory.add('imageUpload', componentCreator);
  }
}

export class ImageUpload extends Plugin {
  public static override get pluginName(): string {
    return 'ImageUpload';
  }

  public static override get requires() {
    return [ImageUploadEditing, ImageUploadUI, ImageUploadProgress];
  }
}

export function createImageTypeRegExp(types: string[]): RegExp {
  const regExpSafeNames = types.map(type => type.replace('+', '\\+'));
  return new RegExp(`^image\\/(${regExpSafeNames.join('|')})$`);
}

function isHtmlIncluded(dataTransfer: any): boolean {
  return Array.from(dataTransfer.types as string[]).includes('text/html') && dataTransfer.getData('text/html') !== '';
}

function isLocalImage(imageUtils: ImageUtils, node: ViewElement): boolean {
  if (!imageUtils.isInlineImageView(node) || !node.getAttribute('src')) return false;
  return !!node.getAttribute('src')!.match(/^data:image\/\w+;base64,/g) || !!node.getAttribute('src')!.match(/^blob:/g);
}

function fetchLocalImage(image: ViewElement): Promise<File> {
  return new Promise((resolve, reject) => {
    const imageSrc = image.getAttribute('src')!;
    fetch(imageSrc)
      .then(resource => resource.blob())
      .then(blob => {
        const mimeType = getImageMimeType(blob, imageSrc);
        const ext = mimeType.replace('image/', '');
        const filename = `image.${ext}`;
        const file = new File([blob], filename, { type: mimeType });
        resolve(file);
      })
      .catch(err => (err && err.name === 'TypeError' ? convertLocalImage(imageSrc).then(resolve).catch(reject) : reject(err)));
  });
}

function getImageMimeType(blob: Blob, src: string): string {
  if (blob.type) return blob.type;
  if (src.match(/data:(image\/\w+);base64/)) return src.match(/data:(image\/\w+);base64/)![1].toLowerCase();
  return 'image/jpeg';
}

function convertLocalImage(imageSrc: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      canvas.toBlob(blob => (blob ? resolve(new File([blob], 'image.png', { type: 'image/png' })) : reject()));
    };
    image.onerror = () => reject();
    image.src = imageSrc;
  });
}

import { UpcastWriter } from '../../engine/view/upcastwriter';
function require_upcast_writer(): typeof UpcastWriter {
  return UpcastWriter;
}
