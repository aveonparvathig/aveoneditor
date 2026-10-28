import type { Operation } from './operation/operation';

/** Stores the document's operation history and undo pairs. */
export class History {
  private _operations: Operation[] = [];
  private _undoPairs = new Map<Operation, Operation>();
  private _undoneOperations = new Set<Operation>();
  private _baseVersionToOperationIndex = new Map<number, number>();
  private _version = 0;
  private _gaps = new Map<number, number>();

  public get version(): number {
    return this._version;
  }

  public set version(version: number) {
    if (this._operations.length && version > this._version) {
      this._gaps.set(this._version, version);
    }
    this._version = version;
  }

  public get lastOperation(): Operation | undefined {
    return this._operations[this._operations.length - 1];
  }

  public addOperation(operation: Operation): void {
    if (this._operations.includes(operation)) return;
    this._operations.push(operation);
    this._baseVersionToOperationIndex.set(operation.baseVersion!, this._operations.length - 1);
    this._version++;
  }

  public getOperations(fromBaseVersion?: number, toBaseVersion?: number): Operation[] {
    if (!this._operations.length) return [];
    const firstOperation = this._operations[0];
    if (fromBaseVersion === undefined) fromBaseVersion = firstOperation.baseVersion!;
    let toBaseVersionResolved = toBaseVersion === undefined ? this._version : toBaseVersion;
    if (toBaseVersionResolved > this._version) toBaseVersionResolved = this._version;
    let fromIndex = this._baseVersionToOperationIndex.get(fromBaseVersion);
    if (fromIndex === undefined) {
      fromIndex = this._operations.length;
      for (let i = 0; i < this._operations.length; i++) {
        if (this._operations[i].baseVersion! >= fromBaseVersion) {
          fromIndex = i;
          break;
        }
      }
    }
    let toIndex = this._baseVersionToOperationIndex.get(toBaseVersionResolved);
    if (toIndex === undefined) toIndex = this._operations.length;
    return this._operations.slice(fromIndex, toIndex);
  }

  public getOperation(baseVersion: number): Operation | undefined {
    const index = this._baseVersionToOperationIndex.get(baseVersion);
    return index === undefined ? undefined : this._operations[index];
  }

  public setOperationAsUndone(undoneOperation: Operation, undoingOperation: Operation): void {
    this._undoPairs.set(undoingOperation, undoneOperation);
    this._undoneOperations.add(undoneOperation);
  }

  public isUndoingOperation(operation: Operation): boolean {
    return this._undoPairs.has(operation);
  }

  public isUndoneOperation(operation: Operation): boolean {
    return this._undoneOperations.has(operation);
  }

  public getUndoneOperation(undoingOperation: Operation): Operation | undefined {
    return this._undoPairs.get(undoingOperation);
  }

  public reset(): void {
    this._version = 0;
    this._undoPairs = new Map();
    this._operations = [];
    this._undoneOperations = new Set();
    this._gaps = new Map();
    this._baseVersionToOperationIndex = new Map();
  }
}
