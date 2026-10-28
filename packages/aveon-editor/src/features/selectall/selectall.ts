import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import type { Element } from '../../engine/model/element';

/** Selects all content of the closest limit element; repeated use climbs up. */
export class SelectAllCommand extends Command {
  constructor(editor: any) {
    super(editor);
    this.affectsData = false;
  }

  public override execute(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    let scopeElement: Element | null = model.schema.getLimitElement(selection);
    if (selection.containsEntireContent(scopeElement) || !isSelectAllScope(model.schema, scopeElement)) {
      do {
        scopeElement = scopeElement!.parent as Element | null;
        if (!scopeElement) return;
      } while (!isSelectAllScope(model.schema, scopeElement));
    }
    model.change(writer => {
      writer.setSelection(scopeElement!, 'in');
    });
  }
}

function isSelectAllScope(schema: any, element: Element): boolean {
  return schema.isLimit(element) && (schema.checkChild(element, '$text') || schema.checkChild(element, 'paragraph'));
}

export class SelectAllEditing extends Plugin {
  public static override get pluginName(): string {
    return 'SelectAllEditing';
  }

  public override init(): void {
    const editor = this.editor;
    const view = editor.editing.view;
    const viewDocument = view.document;
    editor.commands.add('selectAll', new SelectAllCommand(editor));
    this.listenTo(viewDocument, 'keydown', (eventInfo, domEventData: any) => {
      if (domEventData.keystroke === parseKeystrokeCtrlA()) {
        editor.execute('selectAll');
        domEventData.preventDefault();
      }
    });
  }
}

import { parseKeystroke } from '../../utils/keyboard';
function parseKeystrokeCtrlA(): number {
  return parseKeystroke('Ctrl+A');
}

export class SelectAllUI extends Plugin {
  public static override get pluginName(): string {
    return 'SelectAllUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.ui.componentFactory.add('selectAll', locale => {
      const command = editor.commands.get('selectAll')!;
      const view = new ButtonView(locale);
      view.set({ label: t('Select all'), icon: icons.check, keystroke: 'Ctrl+A', tooltip: true });
      view.bind('isEnabled').to(command, 'isEnabled');
      this.listenTo(view, 'execute', () => {
        editor.execute('selectAll');
        editor.editing.view.focus();
      });
      return view;
    });
  }
}

export class SelectAll extends Plugin {
  public static override get requires() {
    return [SelectAllEditing, SelectAllUI];
  }

  public static override get pluginName(): string {
    return 'SelectAll';
  }
}
