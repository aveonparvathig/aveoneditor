import { Command } from '../../core/command';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';
import type { Writer } from '../../engine/model/writer';

export type ListType = 'bulleted' | 'numbered' | 'todo';

/** Turns selected blocks into list items of the given type, or back into paragraphs. */
export class ListCommand extends Command {
  public readonly type: ListType;

  constructor(editor: Editor, type: ListType) {
    super(editor);
    this.type = type;
  }

  public override refresh(): void {
    this.value = this._getValue();
    this.isEnabled = this._checkEnabled();
  }

  public override execute(options: { forceValue?: boolean } = {}): void {
    const model = this.editor.model;
    const document = model.document;
    const schema = model.schema;
    const blocks = Array.from(document.selection.getSelectedBlocks()).filter(block => checkCanBecomeListItem(block, schema));
    const turnOff = options.forceValue !== undefined ? !options.forceValue : this.value;

    model.change(writer => {
      if (turnOff) {
        for (const block of blocks.slice().reverse()) {
          if (block.is('element', 'listItem')) {
            turnOffListItem(writer, block);
          }
        }
      } else {
        for (const block of blocks) {
          if (block.is('element', 'listItem')) {
            if (block.getAttribute('listType') !== this.type) {
              writer.setAttribute('listType', this.type, block);
              if (this.type !== 'todo') writer.removeAttribute('todoListChecked', block);
            }
          } else {
            let indent = 0;
            const previous = block.previousSibling as Element | null;
            if (previous && previous.is('element', 'listItem') && previous.getAttribute('listType') === this.type) {
              indent = Number(previous.getAttribute('listIndent'));
            }
            writer.rename(block, 'listItem');
            writer.setAttribute('listType', this.type, block);
            writer.setAttribute('listIndent', indent, block);
          }
        }
      }
    });
  }

  private _getValue(): boolean {
    const firstBlock = first(this.editor.model.document.selection.getSelectedBlocks());
    return !!firstBlock && firstBlock.is('element', 'listItem') && firstBlock.getAttribute('listType') === this.type;
  }

  private _checkEnabled(): boolean {
    if (this.value) return true;
    const selection = this.editor.model.document.selection;
    const schema = this.editor.model.schema;
    const firstBlock = first(selection.getSelectedBlocks());
    if (!firstBlock) return false;
    return checkCanBecomeListItem(firstBlock, schema);
  }
}

/** Indents or outdents selected list items (and their nested items). */
export class IndentListCommand extends Command {
  private readonly _indentBy: number;

  constructor(editor: Editor, indentDirection: 'forward' | 'backward') {
    super(editor);
    this._indentBy = indentDirection === 'forward' ? 1 : -1;
  }

  public override refresh(): void {
    this.isEnabled = this._checkEnabled();
  }

  public override execute(): void {
    const model = this.editor.model;
    const document = model.document;
    let itemsToChange = Array.from(document.selection.getSelectedBlocks()).filter(block => block.is('element', 'listItem'));
    model.change(writer => {
      const lastItem = itemsToChange[itemsToChange.length - 1];
      let next = lastItem ? (lastItem.nextSibling as Element | null) : null;
      const currentIndent = lastItem ? Number(lastItem.getAttribute('listIndent')) : 0;
      while (next && next.is('element', 'listItem') && Number(next.getAttribute('listIndent')) > currentIndent) {
        itemsToChange.push(next);
        next = next.nextSibling as Element | null;
      }
      if (this._indentBy < 0) {
        itemsToChange = itemsToChange.reverse();
      }
      for (const item of itemsToChange) {
        const indent = Number(item.getAttribute('listIndent')) + this._indentBy;
        if (indent < 0) {
          turnOffListItem(writer, item);
        } else {
          writer.setAttribute('listIndent', indent, item);
        }
      }
    });
  }

  private _checkEnabled(): boolean {
    const listItem = first(this.editor.model.document.selection.getSelectedBlocks());
    if (!listItem || !listItem.is('element', 'listItem')) return false;
    if (this._indentBy > 0) {
      const indent = Number(listItem.getAttribute('listIndent'));
      let prev = listItem.previousSibling as Element | null;
      while (prev && prev.is('element', 'listItem')) {
        const prevIndent = Number(prev.getAttribute('listIndent'));
        if (prevIndent === indent) return true;
        if (prevIndent < indent) return false;
        prev = prev.previousSibling as Element | null;
      }
      return false;
    }
    return true;
  }
}

/** Toggles the `todoListChecked` attribute on selected to-do items. */
export class CheckTodoListCommand extends Command {
  declare public value: boolean;

  constructor(editor: Editor) {
    super(editor);
    this.set('value', false);
  }

  public override refresh(): void {
    const selectedElements = this._getSelectedItems();
    this.isEnabled = selectedElements.length > 0;
    this.value = selectedElements.every(element => !!element.getAttribute('todoListChecked'));
  }

  public override execute(options: { forceValue?: boolean; selection?: any } = {}): void {
    this.editor.model.change(writer => {
      const items = options.selection ? Array.from(options.selection.getSelectedBlocks()).filter((b: any) => b.is('element', 'listItem') && b.getAttribute('listType') === 'todo') : this._getSelectedItems();
      const value = options.forceValue === undefined ? !this.value : options.forceValue;
      for (const element of items as Element[]) {
        if (value) {
          writer.setAttribute('todoListChecked', true, element);
        } else {
          writer.removeAttribute('todoListChecked', element);
        }
      }
    });
  }

  private _getSelectedItems(): Element[] {
    const selection = this.editor.model.document.selection;
    return Array.from(selection.getSelectedBlocks()).filter(block => block.is('element', 'listItem') && block.getAttribute('listType') === 'todo');
  }
}

export function turnOffListItem(writer: Writer, block: Element): void {
  writer.rename(block, 'paragraph');
  writer.removeAttribute('listType', block);
  writer.removeAttribute('listIndent', block);
  writer.removeAttribute('todoListChecked', block);
}

export function checkCanBecomeListItem(block: Element, schema: any): boolean {
  return schema.checkChild(block.parent as Element, 'listItem') && !schema.isObject(block);
}
