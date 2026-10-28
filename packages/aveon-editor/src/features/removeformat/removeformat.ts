import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import type { Item } from '../../engine/model/item';

/** Removes formatting attributes (bold, italic, font...) from the selection. */
export class RemoveFormatCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    this.isEnabled = !!first(this._getFormattingItems(model.document, model.schema));
  }

  public override execute(): void {
    const model = this.editor.model;
    const schema = model.schema;
    model.change(writer => {
      for (const item of this._getFormattingItems(model.document, schema)) {
        if ((item as any).is('selection')) {
          for (const attributeName of this._getFormattingAttributes(item as any, schema)) {
            writer.removeSelectionAttribute(attributeName);
          }
        } else {
          const itemRange = writer.createRangeOn(item as Item);
          for (const attributeName of this._getFormattingAttributes(item as any, schema)) {
            writer.removeAttribute(attributeName, itemRange);
          }
        }
      }
    });
  }

  private *_getFormattingItems(document: any, schema: any): IterableIterator<any> {
    const itemHasRemovableFormatting = (item: any) => !!first(this._getFormattingAttributes(item, schema));
    for (const curRange of document.selection.getRanges()) {
      for (const item of curRange.getItems()) {
        if (!schema.isBlock(item) && itemHasRemovableFormatting(item)) {
          yield item;
        }
      }
    }
    for (const block of document.selection.getSelectedBlocks()) {
      if (itemHasRemovableFormatting(block)) yield block;
    }
    if (itemHasRemovableFormatting(document.selection)) yield document.selection;
  }

  private *_getFormattingAttributes(item: any, schema: any): IterableIterator<string> {
    for (const [attributeName] of item.getAttributes()) {
      const attributeProperties = schema.getAttributeProperties(attributeName);
      if (attributeProperties && attributeProperties.isFormatting) {
        yield attributeName;
      }
    }
  }
}

export class RemoveFormatEditing extends Plugin {
  public static override get pluginName(): string {
    return 'RemoveFormatEditing';
  }

  public override init(): void {
    this.editor.commands.add('removeFormat', new RemoveFormatCommand(this.editor));
  }
}

export class RemoveFormatUI extends Plugin {
  public static override get pluginName(): string {
    return 'RemoveFormatUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('removeFormat', locale => {
      const command = editor.commands.get('removeFormat')!;
      const view = new ButtonView(locale);
      view.set({ label: t('Remove Format'), icon: icons.removeFormat, tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => {
        editor.execute('removeFormat');
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class RemoveFormat extends Plugin {
  public static override get requires() {
    return [RemoveFormatEditing, RemoveFormatUI];
  }

  public static override get pluginName(): string {
    return 'RemoveFormat';
  }
}
