import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { transformOperation } from './transform';
import { Range } from '../../engine/model/range';
import { MergeOperation } from '../../engine/model/operation/mergeoperation';
import { SplitOperation } from '../../engine/model/operation/splitoperation';
import type { Editor } from '../../core/editor';
import type { Batch } from '../../engine/model/batch';
import type { Operation } from '../../engine/model/operation/operation';

interface StackItem {
  batch: Batch;
  selection: { ranges: Range[]; isBackward: boolean };
}

/** Base for undo and redo commands: keeps a stack of batches and restores the selection. */
export abstract class BaseCommand extends Command {
  protected _stack: StackItem[] = [];
  public readonly _createdBatches = new WeakSet<Batch>();

  constructor(editor: Editor) {
    super(editor);
    this.listenTo(editor.data, 'set', (evt, data: any[]) => {
      data[1] = { ...data[1] };
      const options = data[1];
      if (!options.batchType) {
        options.batchType = { isUndoable: false };
      }
    }, { priority: 'high' });
    this.listenTo(editor.data, 'set', (evt, data: any[]) => {
      const options = data[1];
      if (options.batchType.isUndoable) {
        this.clearStack();
      }
    });
  }

  public override refresh(): void {
    this.isEnabled = this._stack.length > 0;
  }

  public get createdBatches(): WeakSet<Batch> {
    return this._createdBatches;
  }

  public addBatch(batch: Batch): void {
    const docSelection = this.editor.model.document.selection;
    const selection = {
      ranges: docSelection.hasOwnRange ? Array.from(docSelection.getRanges()) : [],
      isBackward: docSelection.isBackward
    };
    this._stack.push({ batch, selection });
    this.refresh();
  }

  public clearStack(): void {
    this._stack = [];
    this.refresh();
  }

  protected _restoreSelection(ranges: Range[], isBackward: boolean, operations: Operation[]): void {
    const model = this.editor.model;
    const document = model.document;
    const selectionRanges: Range[] = [];
    const transformedRangeGroups = ranges.map(range => range.getTransformedByOperations(operations));
    const allRanges = transformedRangeGroups.flat();
    for (const range of allRanges) {
      if ((range.root as any).rootName === '$graveyard') continue;
      const isContained = allRanges.some(other => other !== range && other.containsRange(range, true));
      if (!isContained) selectionRanges.push(range);
    }
    if (selectionRanges.length) {
      model.change(writer => {
        try {
          writer.setSelection(selectionRanges, { backward: isBackward });
        } catch {
          /* invalid ranges; leave selection */
        }
      });
    }
    void document;
  }

  protected _undo(batchToUndo: Batch, undoingBatch: Batch): void {
    const model = this.editor.model;
    const document = model.document;
    this._createdBatches.add(undoingBatch);

    const operationsToUndo = batchToUndo.operations.slice().filter(operation => operation.isDocumentOperation);
    operationsToUndo.reverse();

    for (const operationToUndo of operationsToUndo) {
      const nextBaseVersion = operationToUndo.baseVersion! + 1;
      const historyOperations = Array.from(document.history.getOperations(nextBaseVersion));
      let reversedOperations: Operation[] = [operationToUndo.getReversed()];
      for (const historyOperation of historyOperations) {
        const transformed: Operation[] = [];
        for (const reversed of reversedOperations) {
          transformed.push(...transformOperation(reversed, historyOperation));
        }
        reversedOperations = transformed;
      }
      for (const reversed of reversedOperations) {
        if (reversed.type === 'noop') continue;
        if (reversed instanceof SplitOperation) {
          const parent = reversed.splitPosition.parent;
          (reversed as any).howMany = parent.maxOffset - reversed.splitPosition.offset;
        }
        if (reversed instanceof MergeOperation) {
          (reversed as any).howMany = reversed.sourcePosition.parent.maxOffset;
        }
        reversed.baseVersion = document.version;
        undoingBatch.addOperation(reversed);
        try {
          model.applyOperation(reversed);
        } catch (err) {
          console.warn('Aveon Editor: undo operation could not be applied', err);
          continue;
        }
        document.history.setOperationAsUndone(operationToUndo, reversed);
      }
    }
  }
}

export class UndoCommand extends BaseCommand {
  public override execute(batch: Batch | null = null): void {
    const batchIndex = batch ? this._stack.findIndex(a => a.batch === batch) : this._stack.length - 1;
    const item = this._stack.splice(batchIndex, 1)[0];
    const undoingBatch = this.editor.model.createBatch({ isUndo: true });
    this.editor.model.enqueueChange(undoingBatch, () => {
      this._undo(item.batch, undoingBatch);
      const operations = this.editor.model.document.history.getOperations(item.batch.baseVersion!);
      this._restoreSelection(item.selection.ranges, item.selection.isBackward, operations);
    });
    this.fire('revert', item.batch, undoingBatch);
    this.refresh();
  }
}

export class RedoCommand extends BaseCommand {
  public override execute(): void {
    const item = this._stack.pop()!;
    const redoingBatch = this.editor.model.createBatch({ isUndo: true });
    this.editor.model.enqueueChange(redoingBatch, () => {
      const lastOperation = item.batch.operations[item.batch.operations.length - 1];
      const nextBaseVersion = lastOperation.baseVersion! + 1;
      const operations = this.editor.model.document.history.getOperations(nextBaseVersion);
      this._restoreSelection(item.selection.ranges, item.selection.isBackward, operations);
      this._undo(item.batch, redoingBatch);
    });
    this.refresh();
  }
}

export class UndoEditing extends Plugin {
  private _undoCommand!: UndoCommand;
  private _redoCommand!: RedoCommand;
  private _batchRegistry = new WeakSet<Batch>();

  public static override get pluginName(): string {
    return 'UndoEditing';
  }

  public override init(): void {
    const editor = this.editor;
    this._undoCommand = new UndoCommand(editor);
    this._redoCommand = new RedoCommand(editor);
    editor.commands.add('undo', this._undoCommand);
    editor.commands.add('redo', this._redoCommand);

    this.listenTo(editor.model, 'applyOperation', (evt, args: [Operation]) => {
      const operation = args[0];
      if (!operation.isDocumentOperation) return;
      const batch = operation.batch!;
      const isRedoBatch = this._redoCommand.createdBatches.has(batch);
      const isUndoBatch = this._undoCommand.createdBatches.has(batch);
      const wasProcessed = this._batchRegistry.has(batch);
      if (wasProcessed) return;
      this._batchRegistry.add(batch);
      if (!batch.isUndoable) return;
      if (isRedoBatch) {
        this._undoCommand.addBatch(batch);
      } else if (!isUndoBatch) {
        this._undoCommand.addBatch(batch);
        this._redoCommand.clearStack();
      }
    }, { priority: 'highest' });

    this.listenTo(this._undoCommand, 'revert', (evt, batch: Batch, undoingBatch: Batch) => {
      this._redoCommand.addBatch(undoingBatch);
    });

    editor.keystrokes.set('CTRL+Z', 'undo');
    editor.keystrokes.set('CTRL+Y', 'redo');
    editor.keystrokes.set('CTRL+SHIFT+Z', 'redo');
  }
}

export class UndoUI extends Plugin {
  public static override get pluginName(): string {
    return 'UndoUI';
  }

  public override init(): void {
    const editor = this.editor;
    const locale = editor.locale;
    const t = editor.t;
    const localizedUndoIcon = locale.uiLanguageDirection === 'ltr' ? icons.undo : icons.redo;
    const localizedRedoIcon = locale.uiLanguageDirection === 'ltr' ? icons.redo : icons.undo;
    this._addButton('undo', t('Undo'), 'CTRL+Z', localizedUndoIcon);
    this._addButton('redo', t('Redo'), 'CTRL+Y', localizedRedoIcon);
  }

  private _addButton(name: string, label: string, keystroke: string, icon: string): void {
    const editor = this.editor;
    editor.ui.componentFactory.add(name, locale => {
      const command = editor.commands.get(name)!;
      const view = new ButtonView(locale);
      view.set({ label, icon, keystroke, tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => {
        editor.execute(name);
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class Undo extends Plugin {
  public static override get requires() {
    return [UndoEditing, UndoUI];
  }

  public static override get pluginName(): string {
    return 'Undo';
  }
}
