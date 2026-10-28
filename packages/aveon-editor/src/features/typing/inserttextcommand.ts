import { Command } from '../../core/command';
import { ChangeBuffer } from './changebuffer';
import type { Editor } from '../../core/editor';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import type { Range } from '../../engine/model/range';

export interface InsertTextCommandOptions {
  text?: string;
  selection?: Selection | DocumentSelection;
  range?: Range;
  resultRange?: Range;
}

/** Inserts text at the selection (replacing selected content), grouping changes for undo. */
export class InsertTextCommand extends Command {
  private readonly _buffer: ChangeBuffer;

  constructor(editor: Editor, undoStepSize: number) {
    super(editor);
    this._buffer = new ChangeBuffer(editor.model, undoStepSize);
  }

  public get buffer(): ChangeBuffer {
    return this._buffer;
  }

  public override destroy(): void {
    super.destroy();
    this._buffer.destroy();
  }

  public override execute(options: InsertTextCommandOptions = {}): void {
    const model = this.editor.model;
    const doc = model.document;
    const text = options.text || '';
    const textInsertions = text.length;
    let selection: Selection | DocumentSelection = doc.selection;
    if (options.selection) {
      selection = options.selection;
    } else if (options.range) {
      selection = model.createSelection(options.range);
    }
    const resultRange = options.resultRange;

    model.enqueueChange(this._buffer.batch, writer => {
      this._buffer.lock();
      model.deleteContent(selection);
      if (text) {
        model.insertContent(writer.createText(text, doc.selection.getAttributes()), selection);
      }
      if (resultRange) {
        writer.setSelection(resultRange);
      } else if (!(selection as any).is('documentSelection')) {
        writer.setSelection(selection as Selection);
      }
      this._buffer.unlock();
      this._buffer.input(textInsertions);
    });
  }
}
