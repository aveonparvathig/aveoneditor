import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { toWidget } from '../widget/utils';
import { Widget } from '../widget/widget';

export class HorizontalLineCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const schema = model.schema;
    const selection = model.document.selection;
    const positionParent = selection.getFirstPosition()!.parent as any;
    const validParent = positionParent === positionParent.root ? positionParent : positionParent.parent;
    this.isEnabled = schema.checkChild(validParent, 'horizontalLine');
  }

  public override execute(): void {
    const model = this.editor.model;
    model.change(writer => {
      const horizontalElement = writer.createElement('horizontalLine');
      model.insertObject(horizontalElement, null, null, { setSelection: 'after' });
    });
  }
}

export class HorizontalLineEditing extends Plugin {
  public static override get pluginName(): string {
    return 'HorizontalLineEditing';
  }

  public static override get requires() {
    return [Widget];
  }

  public override init(): void {
    const editor = this.editor;
    const schema = editor.model.schema;
    const t = editor.t;
    const conversion = editor.conversion;
    schema.register('horizontalLine', { inheritAllFrom: '$blockObject' });
    conversion.for('dataDowncast').elementToElement({ model: 'horizontalLine', view: (modelElement, { writer }) => writer.createEmptyElement('hr') });
    conversion.for('editingDowncast').elementToElement({
      model: 'horizontalLine',
      view: (modelElement, { writer }) => {
        const label = t('Horizontal line');
        const viewWrapper = writer.createContainerElement('div', { class: 'ck-horizontal-line' });
        const viewHrElement = writer.createEmptyElement('hr');
        writer.insert(writer.createPositionAt(viewWrapper, 0), viewHrElement);
        return toWidget(viewWrapper, writer, { label });
      }
    });
    conversion.for('upcast').elementToElement({ view: 'hr', model: 'horizontalLine' });
    editor.commands.add('horizontalLine', new HorizontalLineCommand(editor));
  }
}

export class HorizontalLineUI extends Plugin {
  public static override get pluginName(): string {
    return 'HorizontalLineUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('horizontalLine', locale => {
      const command = editor.commands.get('horizontalLine')!;
      const view = new ButtonView(locale);
      view.set({ label: t('Horizontal line'), icon: icons.horizontalLine, tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => {
        editor.execute('horizontalLine');
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class HorizontalLine extends Plugin {
  public static override get requires() {
    return [HorizontalLineEditing, HorizontalLineUI, Widget];
  }

  public static override get pluginName(): string {
    return 'HorizontalLine';
  }
}
