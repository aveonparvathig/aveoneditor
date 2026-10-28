import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import { Enter } from '../enter/enter';
import { Delete } from '../typing/delete';
import type { Element } from '../../engine/model/element';
import type { Writer } from '../../engine/model/writer';
import type { Range } from '../../engine/model/range';

/** Wraps/unwraps selected blocks in a block quote. */
export class BlockQuoteCommand extends Command {
  public override refresh(): void {
    this.value = this._getValue();
    this.isEnabled = this._checkEnabled();
  }

  public override execute(options: { forceValue?: boolean } = {}): void {
    const model = this.editor.model;
    const schema = model.schema;
    const selection = model.document.selection;
    const blocks = Array.from(selection.getSelectedBlocks());
    const value = options.forceValue === undefined ? !this.value : options.forceValue;
    model.change(writer => {
      if (!value) {
        this._removeQuote(writer, blocks.filter(findQuote));
      } else {
        const blocksToQuote = blocks.filter(block => findQuote(block) || checkCanBeQuoted(schema, block));
        this._applyQuote(writer, blocksToQuote);
      }
    });
  }

  private _getValue(): boolean {
    const selection = this.editor.model.document.selection;
    const firstBlock = first(selection.getSelectedBlocks());
    return !!(firstBlock && findQuote(firstBlock));
  }

  private _checkEnabled(): boolean {
    if (this.value) return true;
    const selection = this.editor.model.document.selection;
    const schema = this.editor.model.schema;
    const firstBlock = first(selection.getSelectedBlocks());
    if (!firstBlock) return false;
    return checkCanBeQuoted(schema, firstBlock);
  }

  private _removeQuote(writer: Writer, blocks: Element[]): void {
    getRangesOfBlockGroups(writer, blocks).reverse().forEach(groupRange => {
      if (groupRange.start.isAtStart && groupRange.end.isAtEnd) {
        writer.unwrap(groupRange.start.parent as Element);
        return;
      }
      if (groupRange.start.isAtStart) {
        const positionBefore = writer.createPositionBefore(groupRange.start.parent as Element);
        writer.move(groupRange, positionBefore);
        return;
      }
      if (!groupRange.end.isAtEnd) {
        writer.split(groupRange.end);
      }
      const positionAfter = writer.createPositionAfter(groupRange.end.parent as Element);
      writer.move(groupRange, positionAfter);
    });
  }

  private _applyQuote(writer: Writer, blocks: Element[]): void {
    const quotesToMerge: Element[] = [];
    getRangesOfBlockGroups(writer, blocks).reverse().forEach(groupRange => {
      let quote = findQuote(groupRange.start as any);
      if (!quote) {
        quote = writer.createElement('blockQuote');
        writer.wrap(groupRange, quote);
      }
      quotesToMerge.push(quote);
    });
    quotesToMerge.reverse().reduce((currentQuote: Element, nextQuote: Element) => {
      if (currentQuote.nextSibling === nextQuote) {
        writer.merge(writer.createPositionAfter(currentQuote));
        return currentQuote;
      }
      return nextQuote;
    });
  }
}

function findQuote(elementOrPosition: any): Element | null {
  const parent = elementOrPosition.parent;
  return parent && parent.name === 'blockQuote' ? parent : null;
}

function getRangesOfBlockGroups(writer: Writer, blocks: Element[]): Range[] {
  let startPosition: any;
  let i = 0;
  const ranges: Range[] = [];
  while (i < blocks.length) {
    const block = blocks[i];
    const nextBlock = blocks[i + 1];
    if (!startPosition) startPosition = writer.createPositionBefore(block);
    if (!nextBlock || block.nextSibling !== nextBlock) {
      ranges.push(writer.createRange(startPosition, writer.createPositionAfter(block)));
      startPosition = null;
    }
    i++;
  }
  return ranges;
}

function checkCanBeQuoted(schema: any, block: Element): boolean {
  const isBQAllowed = schema.checkChild(block.parent as Element, 'blockQuote');
  const isBlockAllowedInBQ = schema.checkChild(['$root', 'blockQuote'], block);
  return isBQAllowed && isBlockAllowedInBQ;
}

export class BlockQuoteEditing extends Plugin {
  public static override get pluginName(): string {
    return 'BlockQuoteEditing';
  }

  public static override get requires() {
    return [Enter, Delete];
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    editor.commands.add('blockQuote', new BlockQuoteCommand(editor));
    schema.register('blockQuote', { inheritAllFrom: '$container' });
    editor.conversion.elementToElement({ model: 'blockQuote', view: 'blockquote' });

    // Post-fixer: remove empty block quotes and unwrap blocks not allowed inside.
    editor.model.document.registerPostFixer(writer => {
      const changes = editor.model.document.differ.getChanges();
      for (const entry of changes) {
        if (entry.type === 'insert' || entry.type === 'refresh') {
          const element = (entry as any).node;
          if (element && element.is && element.is('element', 'blockQuote') && element.isEmpty) {
            writer.remove(element);
            return true;
          }
        }
      }
      return false;
    });

    const viewDocument = this.editor.editing.view.document;
    const selection = editor.model.document.selection;
    const blockQuoteCommand = editor.commands.get('blockQuote')!;

    // Enter in an empty block at the end of a quote leaves the quote.
    this.listenTo(viewDocument, 'enter', (evt, data: any) => {
      if (!selection.isCollapsed || !blockQuoteCommand.isEnabled) return;
      const positionParent = selection.getLastPosition()!.parent as Element;
      if (positionParent.isEmpty) {
        editor.execute('blockQuote');
        editor.editing.view.scrollToTheSelection();
        data.preventDefault();
        evt.stop();
      }
    }, { context: 'blockquote' });

    // Backspace at the start of the first block of a quote removes the quote.
    this.listenTo(viewDocument, 'delete', (evt, data: any) => {
      if (data.direction !== 'backward' || !selection.isCollapsed || !blockQuoteCommand.isEnabled) return;
      const positionParent = selection.getLastPosition()!.parent as Element;
      if (positionParent.isEmpty && !positionParent.previousSibling) {
        editor.execute('blockQuote');
        editor.editing.view.scrollToTheSelection();
        data.preventDefault();
        evt.stop();
      }
    }, { context: 'blockquote' });
  }
}

export class BlockQuoteUI extends Plugin {
  public static override get pluginName(): string {
    return 'BlockQuoteUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('blockQuote', locale => {
      const command = editor.commands.get('blockQuote')!;
      const buttonView = new ButtonView(locale);
      buttonView.set({ label: t('Block quote'), icon: icons.blockQuote, tooltip: true, isToggleable: true });
      buttonView.bind('isOn', 'isEnabled').to(command, 'value', 'isEnabled');
      this.listenTo(buttonView, 'execute', () => {
        editor.execute('blockQuote');
        editor.editing.view.focus();
      });
      return buttonView;
    });
  }
}

export class BlockQuote extends Plugin {
  public static override get requires() {
    return [BlockQuoteEditing, BlockQuoteUI];
  }

  public static override get pluginName(): string {
    return 'BlockQuote';
  }
}
