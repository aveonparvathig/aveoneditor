import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { first } from '../../utils/misc';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';
import type { Selection } from '../../engine/model/selection';
import type { DocumentSelection } from '../../engine/model/documentselection';
import type { Position } from '../../engine/model/position';

/** Converts selected blocks to paragraphs. */
export class ParagraphCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const document = model.document;
    const block = first(document.selection.getSelectedBlocks());
    this.value = !!block && block.is('element', 'paragraph');
    this.isEnabled = !!block && checkCanBecomeParagraph(block, model.schema);
  }

  public override execute(options: { selection?: Selection | DocumentSelection } = {}): void {
    const model = this.editor.model;
    const document = model.document;
    const selection = options.selection || document.selection;
    if (!model.canEditAt(selection as any)) return;
    model.change(writer => {
      const blocks = selection.getSelectedBlocks();
      for (const block of blocks) {
        if (!block.is('element', 'paragraph') && checkCanBecomeParagraph(block, model.schema)) {
          writer.rename(block, 'paragraph');
        }
      }
    });
  }
}

function checkCanBecomeParagraph(block: Element, schema: any): boolean {
  return schema.checkChild(block.parent as Element, 'paragraph') && !schema.isObject(block);
}

/** Inserts a paragraph at the given position. */
export class InsertParagraphCommand extends Command {
  constructor(editor: Editor) {
    super(editor);
    this.isEnabledBasedOnSelection = false;
  }

  public override execute(options: { position: Position; attributes?: Record<string, unknown> }): void {
    const model = this.editor.model;
    const attributes = options.attributes;
    let position = options.position;
    if (!model.canEditAt(position as any)) return;
    model.change(writer => {
      position = this._findPositionToInsertParagraph(position, writer)!;
      if (!position) return;
      const paragraph = writer.createElement('paragraph');
      if (attributes) {
        model.schema.setAllowedAttributes(paragraph, attributes, writer);
      }
      if (!model.schema.checkChild(position.parent as Element, paragraph)) {
        const allowedParent = model.schema.findAllowedParent(position, paragraph);
        if (!allowedParent) return;
        position = writer.split(position, allowedParent).position;
      }
      model.insertContent(paragraph, position);
      writer.setSelection(paragraph, 'in');
    });
  }

  private _findPositionToInsertParagraph(position: Position, writer: any): Position | null {
    const model = this.editor.model;
    if (model.schema.checkChild(position, 'paragraph')) return position;
    const allowedParent = model.schema.findAllowedParent(position, 'paragraph');
    if (!allowedParent) return null;
    const positionParent = position.parent as Element;
    const isTextAllowed = model.schema.checkChild(positionParent, '$text');
    if (positionParent.isEmpty || (isTextAllowed && position.isAtEnd)) {
      return model.createPositionAfter(positionParent);
    }
    if (!position.isAtStart && isTextAllowed) {
      return writer.split(position).position;
    }
    return writer.createPositionBefore(positionParent);
  }
}

/** The paragraph feature. Also registers the `paragraph` button. */
export class Paragraph extends Plugin {
  public static override get pluginName(): string {
    return 'Paragraph';
  }

  public static paragraphLikeElements = new Set(['blockquote', 'dd', 'div', 'dt', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'td', 'th']);

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    editor.commands.add('paragraph', new ParagraphCommand(editor));
    editor.commands.add('insertParagraph', new InsertParagraphCommand(editor));
    model.schema.register('paragraph', { inheritAllFrom: '$block' });
    editor.conversion.elementToElement({ model: 'paragraph', view: 'p' });
    editor.conversion.for('upcast').elementToElement({
      model: (viewElement, { writer }) => {
        if (!Paragraph.paragraphLikeElements.has(viewElement.name)) return null;
        if (viewElement.isEmpty) return null;
        return writer.createElement('paragraph');
      },
      view: /.+/,
      converterPriority: 'low'
    });

    editor.ui.componentFactory.add('paragraph', locale => {
      const view = new ButtonView(locale);
      const command = editor.commands.get('paragraph')!;
      view.label = editor.t('Paragraph');
      view.icon = icons.paragraph;
      view.tooltip = true;
      view.isToggleable = true;
      view.bind('isEnabled').to(command);
      view.bind('isOn').to(command, 'value');
      view.on('execute', () => editor.execute('paragraph'));
      return view;
    });
  }
}
