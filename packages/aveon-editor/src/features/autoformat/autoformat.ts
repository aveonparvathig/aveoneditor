import { Plugin } from '../../core/plugin';
import { Delete } from '../typing/delete';
import type { Editor } from '../../core/editor';
import type { Range } from '../../engine/model/range';
import type { Writer } from '../../engine/model/writer';

type BlockCallback = (writer: Writer) => boolean | void;
type InlineCallback = (writer: Writer, rangesToFormat: Range[]) => boolean | void;

/** Formats typed Markdown-like patterns (`# `, `* `, `**bold**`...). */
export class Autoformat extends Plugin {
  public static override get requires() {
    return [Delete];
  }

  public static override get pluginName(): string {
    return 'Autoformat';
  }

  public override afterInit(): void {
    this._addListAutoformats();
    this._addBasicStylesAutoformats();
    this._addHeadingAutoformats();
    this._addBlockQuoteAutoformats();
    this._addCodeBlockAutoformats();
    this._addHorizontalLineAutoformats();
  }

  private _addListAutoformats(): void {
    const commands = this.editor.commands;
    if (commands.get('bulletedList')) {
      blockAutoformatEditing(this.editor, this, /^[*-]\s$/, 'bulletedList');
    }
    if (commands.get('numberedList')) {
      blockAutoformatEditing(this.editor, this, /^1[.|)]\s$/, 'numberedList');
    }
    if (commands.get('todoList')) {
      blockAutoformatEditing(this.editor, this, /^\[\s?\]\s$/, 'todoList');
    }
    if (commands.get('checkTodoList')) {
      blockAutoformatEditing(this.editor, this, /^\[\s?x\s?\]\s$/, () => {
        this.editor.execute('todoList');
        this.editor.execute('checkTodoList');
      });
    }
  }

  private _addBasicStylesAutoformats(): void {
    const commands = this.editor.commands;
    if (commands.get('bold')) {
      const boldCallback = getCallbackFunctionForInlineAutoformat(this.editor, 'bold');
      inlineAutoformatEditing(this.editor, this, /(?:^|\s)(\*\*)([^*]+)(\*\*)$/g, boldCallback);
      inlineAutoformatEditing(this.editor, this, /(?:^|\s)(__)([^_]+)(__)$/g, boldCallback);
    }
    if (commands.get('italic')) {
      const italicCallback = getCallbackFunctionForInlineAutoformat(this.editor, 'italic');
      inlineAutoformatEditing(this.editor, this, /(?:^|\s)(\*)([^*_]+)(\*)$/g, italicCallback);
      inlineAutoformatEditing(this.editor, this, /(?:^|\s)(_)([^_]+)(_)$/g, italicCallback);
    }
    if (commands.get('code')) {
      const codeCallback = getCallbackFunctionForInlineAutoformat(this.editor, 'code');
      inlineAutoformatEditing(this.editor, this, /(`)([^`]+)(`)$/g, codeCallback);
    }
    if (commands.get('strikethrough')) {
      const strikethroughCallback = getCallbackFunctionForInlineAutoformat(this.editor, 'strikethrough');
      inlineAutoformatEditing(this.editor, this, /(~~)([^~]+)(~~)$/g, strikethroughCallback);
    }
  }

  private _addHeadingAutoformats(): void {
    const command = this.editor.commands.get('heading') as any;
    if (command) {
      command.modelElements.filter((name: string) => name.match(/^heading[1-6]$/)).forEach((modelName: string) => {
        const level = modelName[7];
        const pattern = new RegExp(`^(#{${level}})\\s$`);
        blockAutoformatEditing(this.editor, this, pattern, () => {
          if (!command.isEnabled || command.value === modelName) return false;
          this.editor.execute('heading', { value: modelName });
        });
      });
    }
  }

  private _addBlockQuoteAutoformats(): void {
    if (this.editor.commands.get('blockQuote')) {
      blockAutoformatEditing(this.editor, this, /^>\s$/, 'blockQuote');
    }
  }

  private _addCodeBlockAutoformats(): void {
    const editor = this.editor;
    const selection = editor.model.document.selection;
    if (editor.commands.get('codeBlock')) {
      blockAutoformatEditing(editor, this, /^```$/, () => {
        if (selection.getFirstPosition()!.parent.is('element', 'listItem')) return false;
        this.editor.execute('codeBlock', { usePreviousLanguageChoice: true });
      });
    }
  }

  private _addHorizontalLineAutoformats(): void {
    if (this.editor.commands.get('horizontalLine')) {
      blockAutoformatEditing(this.editor, this, /^---$/, 'horizontalLine');
    }
  }
}

function getCallbackFunctionForInlineAutoformat(editor: Editor, attributeKey: string): InlineCallback {
  return (writer, rangesToFormat) => {
    const command = editor.commands.get(attributeKey)!;
    if (!command.isEnabled) return false;
    const validRanges = editor.model.schema.getValidRanges(rangesToFormat, attributeKey);
    for (const range of validRanges) {
      writer.setAttribute(attributeKey, true, range);
    }
    writer.removeSelectionAttribute(attributeKey);
  };
}

/** Watches text typed at the beginning of a block; on match removes the pattern and runs the callback/command. */
export function blockAutoformatEditing(editor: Editor, plugin: Autoformat, pattern: RegExp, callbackOrCommand: string | BlockCallback): void {
  let callback: BlockCallback;
  let command: any = null;
  if (typeof callbackOrCommand === 'function') {
    callback = callbackOrCommand;
  } else {
    command = editor.commands.get(callbackOrCommand)!;
    callback = () => {
      editor.execute(callbackOrCommand);
    };
  }
  editor.model.document.on('change:data', (evt, batch: any) => {
    if (command && !command.isEnabled) return;
    if (!plugin.isEnabled) return;
    const range = editor.model.document.selection.getFirstRange()!;
    if (!range.isCollapsed) return;
    if (batch.isUndo || !batch.isLocal) return;
    const changes = Array.from(editor.model.document.differ.getChanges());
    if (!changes.length) return;
    const blockToFormat = range.start.parent as any;
    const firstNode = blockToFormat.getChild(0);
    const firstNodeText = firstNode && firstNode.is('$text') ? firstNode.data : '';
    const text = blockToFormat.childCount === 1 && firstNode && firstNode.is('$text') ? firstNodeText : null;
    if (text === null) return;
    const textToMatch = text.substring(0, range.start.offset);
    if (textToMatch !== text) return;
    const match = pattern.exec(textToMatch);
    if (!match) return;
    editor.model.enqueueChange(writer => {
      const start = writer.createPositionAt(blockToFormat, 0);
      const end = writer.createPositionAt(blockToFormat, match[0].length);
      const removeRange = writer.createRange(start, end);
      const wasChanged = callback(writer);
      if (wasChanged !== false) {
        writer.remove(removeRange);
        const selectionRange = editor.model.document.selection.getFirstRange()!;
        const blockRange = writer.createRangeIn(blockToFormat);
        if (blockToFormat.isEmpty || blockRange.end.isBefore(selectionRange.end)) {
          writer.setSelection(blockRange.end);
        }
      }
    });
  });
}

/** Watches text typed inline; on pattern match applies the format and removes the delimiters. */
export function inlineAutoformatEditing(editor: Editor, plugin: Autoformat, pattern: RegExp, formatCallback: InlineCallback): void {
  const testCallback = (text: string) => {
    let result: RegExpExecArray | null;
    const remove: Array<[number, number]> = [];
    const format: Array<[number, number]> = [];
    pattern.lastIndex = 0;
    while ((result = pattern.exec(text)) !== null) {
      if (result && result.length < 4) break;
      let { index, '1': leftDel, '2': content, '3': rightDel } = result;
      const found = leftDel + content + rightDel;
      index += result[0].length - found.length;
      const delStart: [number, number] = [index, index + leftDel.length];
      const delEnd: [number, number] = [index + leftDel.length + content.length, index + leftDel.length + content.length + rightDel.length];
      remove.push(delStart);
      remove.push(delEnd);
      format.push([index + leftDel.length, index + leftDel.length + content.length]);
    }
    return { remove, format };
  };

  editor.model.document.on('change:data', (evt, batch: any) => {
    if (batch.isUndo || !batch.isLocal || !plugin.isEnabled) return;
    const model = editor.model;
    const selection = model.document.selection;
    if (!selection.isCollapsed) return;
    const changes = Array.from(model.document.differ.getChanges());
    if (!changes.length) return;
    const focus = selection.focus!;
    const block = focus.parent as any;
    const { text, range } = getTextAfterCode(model.createRange(model.createPositionAt(block, 0), focus), model);
    const testOutput = testCallback(text);
    const rangesToFormat = testOutputToRanges(range.start, testOutput.format, model);
    const rangesToRemove = testOutputToRanges(range.start, testOutput.remove, model);
    if (!(rangesToFormat.length && rangesToRemove.length)) return;
    model.enqueueChange(writer => {
      const validRanges = editor.model.schema.getValidRanges(rangesToFormat, 'bold');
      void validRanges;
      const wasChanged = formatCallback(writer, rangesToFormat);
      if (wasChanged === false) return;
      for (const range of rangesToRemove.reverse()) {
        writer.remove(range);
      }
      writer.removeSelectionAttribute('bold');
    });
  });
}

function testOutputToRanges(start: any, arrays: Array<[number, number]>, model: any): Range[] {
  return arrays.filter(array => array[0] !== undefined && array[1] !== undefined).map(array => model.createRange(start.getShiftedBy(array[0]), start.getShiftedBy(array[1])));
}

function getTextAfterCode(range: Range, model: any): { text: string; range: Range } {
  let start = range.start;
  const text = Array.from(range.getItems()).reduce((rangeText: string, node: any) => {
    if (!(node.is('$text') || node.is('$textProxy')) || node.getAttribute('code')) {
      start = model.createPositionAfter(node);
      return '';
    }
    return rangeText + node.data;
  }, '');
  return { text, range: model.createRange(start, range.end) };
}
