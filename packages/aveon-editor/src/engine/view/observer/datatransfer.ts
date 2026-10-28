/** Wrapper around the native DataTransfer object. */
export class DataTransfer {
  public readonly files: File[];
  private _native: globalThis.DataTransfer;

  constructor(nativeDataTransfer: globalThis.DataTransfer, options: { cacheFiles?: boolean } = {}) {
    this.files = options.cacheFiles ? getFiles(nativeDataTransfer) : [];
    this._native = nativeDataTransfer;
    if (!options.cacheFiles) {
      Object.defineProperty(this, 'files', { get: () => getFiles(nativeDataTransfer) });
    }
  }

  public get types(): readonly string[] {
    return this._native.types;
  }

  public getData(type: string): string {
    return this._native.getData(type);
  }

  public setData(type: string, data: string): void {
    this._native.setData(type, data);
  }

  public set effectAllowed(value: globalThis.DataTransfer['effectAllowed']) {
    this._native.effectAllowed = value;
  }

  public get effectAllowed(): globalThis.DataTransfer['effectAllowed'] {
    return this._native.effectAllowed;
  }

  public set dropEffect(value: globalThis.DataTransfer['dropEffect']) {
    this._native.dropEffect = value;
  }

  public get dropEffect(): globalThis.DataTransfer['dropEffect'] {
    return this._native.dropEffect;
  }

  public setDragImage(image: Element, x: number, y: number): void {
    this._native.setDragImage(image, x, y);
  }

  public get isCanceled(): boolean {
    return this._native.dropEffect === 'none' || !!(this._native as any).mozUserCancelled;
  }
}

function getFiles(nativeDataTransfer: globalThis.DataTransfer): File[] {
  const files = Array.from(nativeDataTransfer.files || []);
  const items = Array.from(nativeDataTransfer.items || []);
  if (files.length) return files;
  return items.filter(item => item.kind === 'file').map(item => item.getAsFile()!).filter(Boolean);
}
