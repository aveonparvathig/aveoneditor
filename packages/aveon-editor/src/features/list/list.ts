import { Plugin } from '../../core/plugin';
import { ButtonView } from '../../ui/button/buttonview';
import { icons } from '../../ui/icons';
import { ListEditing } from './listediting';

function createUIComponent(editor: any, commandName: string, label: string, icon: string): void {
  editor.ui.componentFactory.add(commandName, (locale: any) => {
    const command = editor.commands.get(commandName);
    const buttonView = new ButtonView(locale);
    buttonView.set({ label, icon, tooltip: true, isToggleable: true });
    buttonView.bind('isOn', 'isEnabled').to(command, 'value', 'isEnabled');
    buttonView.on('execute', () => {
      editor.execute(commandName);
      editor.editing.view.focus();
    });
    return buttonView;
  });
}

export class ListUI extends Plugin {
  public static override get pluginName(): string {
    return 'ListUI';
  }

  public override init(): void {
    const t = this.editor.t;
    createUIComponent(this.editor, 'numberedList', t('Numbered List'), icons.numberedList);
    createUIComponent(this.editor, 'bulletedList', t('Bulleted List'), icons.bulletedList);
  }
}

export class TodoListUI extends Plugin {
  public static override get pluginName(): string {
    return 'TodoListUI';
  }

  public override init(): void {
    const t = this.editor.t;
    createUIComponent(this.editor, 'todoList', t('To-do List'), icons.todoList);
  }
}

export class List extends Plugin {
  public static override get requires() {
    return [ListEditing, ListUI];
  }

  public static override get pluginName(): string {
    return 'List';
  }
}

export class TodoList extends Plugin {
  public static override get requires() {
    return [ListEditing, TodoListUI];
  }

  public static override get pluginName(): string {
    return 'TodoList';
  }
}

export { ListEditing };
export { ListCommand, IndentListCommand, CheckTodoListCommand } from './listcommands';
