import { Command } from '../../core/command';
import { ChangeBuffer } from './changebuffer';
import { count } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import type { Writer } from '../../engine/model/writer';
import type { Element } from '../../engine/model/element';

export interface DeleteCommandOptions {
  unit?: 'character' | 'codePoint' | 'word';
  sequence?: number;
  selection?: Selection | DocumentSelection;
}

/** Deletes content backward or forward from the selection (Backspace / Delete). */
export class DeleteCommand extends Command {
  public readonly direction: 'forward' | 'backward';
  private readonly _buffer: ChangeBuffer;

  constructor(editor: Editor, direction: 'forward' | 'backward') {
    super(editor);
    this.direction = direction;
    this._buffer = new ChangeBuffer(editor.model, editor.config.get('typing.undoStep') || 20);
  }

  public get buffer(): ChangeBuffer {
    return this._buffer;
  }

  public override execute(options: DeleteCommandOptions = {}): void {
    const model = this.editor.model;
    const doc = model.document;

    model.enqueueChange(this._buffer.batch, writer => {
      this._buffer.lock();
      const selection = writer.createSelection(options.selection || doc.selection);
      const sequence = options.sequence || 1;
      const selectionIsEmptyBeforeModify = selection.isCollapsed;

      if (selection.isCollapsed) {
        model.modifySelection(selection, { direction: this.direction, unit: options.unit, treatEmojiAsSingleUnit: true });
      }

      if (this._shouldEntireContentBeReplacedWithParagraph(sequence)) {
        this._replaceEntireContentWithParagraph(writer);
        return;
      }

      if (selection.isCollapsed) {
        return;
      }

      let changeCount = 0;
      selection.getFirstRange()!.getMinimalFlatRanges().forEach((range: any) => {
        changeCount += count(range.getWalker({ singleCharacters: true, ignoreElementEnd: true, shallow: true }));
      });

      model.deleteContent(selection, { doNotResetEntireContent: selectionIsEmptyBeforeModify, direction: this.direction });
      this._buffer.input(changeCount);
      writer.setSelection(selection);
      this._buffer.unlock();
    });
  }

  private _shouldEntireContentBeReplacedWithParagraph(sequence: number): boolean {
    if (sequence < 2) return false;
    const model = this.editor.model;
    const doc = model.document;
    const selection = doc.selection;
    const limitElement = model.schema.getLimitElement(selection);
    const limitStartPosition = model.createPositionAt(limitElement, 0);
    const limitEndPosition = model.createPositionAt(limitElement, 'end');
    if (!limitStartPosition.isTouching(selection.getFirstPosition()!) || !limitEndPosition.isTouching(selection.getLastPosition()!)) {
      return false;
    }
    if (!model.schema.checkChild(limitElement, 'paragraph')) {
      return false;
    }
    const limitElementFirstChild = limitElement.getChild(0) as Element | null;
    if (limitElementFirstChild && limitElementFirstChild.name === 'paragraph' && limitElement.childCount === 1) {
      return false;
    }
    return true;
  }

  private _replaceEntireContentWithParagraph(writer: Writer): void {
    const model = this.editor.model;
    const doc = model.document;
    const selection = doc.selection;
    const limitElement = model.schema.getLimitElement(selection);
    const paragraph = writer.createElement('paragraph');
    writer.remove(writer.createRangeIn(limitElement));
    writer.insert(paragraph, limitElement);
    writer.setSelection(paragraph, 0);
  }
}
