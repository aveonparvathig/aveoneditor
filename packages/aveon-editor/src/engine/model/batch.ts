import type { Operation } from './operation/operation';

export interface BatchType {
  isUndoable?: boolean;
  isLocal?: boolean;
  isUndo?: boolean;
  isTyping?: boolean;
}

/** A group of operations that form one undo step. */
export class Batch {
  public readonly operations: Operation[] = [];
  public readonly isUndoable: boolean;
  public readonly isLocal: boolean;
  public readonly isUndo: boolean;
  public readonly isTyping: boolean;

  constructor(type: BatchType | 'transparent' | 'default' = {}) {
    if (typeof type === 'string') {
      type = type === 'transparent' ? { isUndoable: false } : {};
    }
    const { isUndoable = true, isLocal = true, isUndo = false, isTyping = false } = type;
    this.isUndoable = isUndoable;
    this.isLocal = isLocal;
    this.isUndo = isUndo;
    this.isTyping = isTyping;
  }

  public get baseVersion(): number | null {
    for (const op of this.operations) {
      if (op.baseVersion !== null) return op.baseVersion;
    }
    return null;
  }

  public addOperation(operation: Operation): Operation {
    operation.batch = this;
    this.operations.push(operation);
    return operation;
  }
}
