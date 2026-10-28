import type { Model } from '../../engine/model/model';
import type { Batch } from '../../engine/model/batch';

/**
 * Groups consecutive typing changes into batches (undo steps) of up to `limit` characters.
 * A new batch starts when the selection moves or another batch changes the document.
 */
export class ChangeBuffer {
  public readonly model: Model;
  public readonly limit: number;
  public size = 0;
  public isLocked = false;
  private _batch: Batch | null = null;
  private readonly _changeCallback: (evt: unknown, batch: Batch) => void;
  private readonly _selectionChangeCallback: () => void;

  constructor(model: Model, limit = 20) {
    this.model = model;
    this.limit = limit;
    this._changeCallback = (evt, batch) => {
      if (batch.isLocal && batch.isUndoable && batch !== this._batch) {
        this._reset(true);
      }
    };
    this._selectionChangeCallback = () => {
      this._reset();
    };
    this.model.document.on('change', this._changeCallback);
    this.model.document.selection.on('change:range', this._selectionChangeCallback);
    this.model.document.selection.on('change:attribute', this._selectionChangeCallback);
  }

  public get batch(): Batch {
    if (!this._batch) {
      this._batch = this.model.createBatch({ isTyping: true });
    }
    return this._batch;
  }

  public input(changeCount: number): void {
    this.size += changeCount;
    if (this.size >= this.limit) {
      this._reset(true);
    }
  }

  public lock(): void {
    this.isLocked = true;
  }

  public unlock(): void {
    this.isLocked = false;
  }

  public destroy(): void {
    this.model.document.off('change', this._changeCallback);
    this.model.document.selection.off('change:range', this._selectionChangeCallback);
    this.model.document.selection.off('change:attribute', this._selectionChangeCallback);
  }

  private _reset(ignoreLock = false): void {
    if (!this.isLocked || ignoreLock) {
      this._batch = null;
      this.size = 0;
    }
  }
}
