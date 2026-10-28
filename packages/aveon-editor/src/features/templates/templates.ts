/**
 * Content templates (quotes, letters, emails…) inserted from a "Templates" dropdown.
 *
 *   templates: [
 *     { title: 'Quotation', description: 'Standard sales quote', data: '<h2>Quotation</h2><p>…</p>' },
 *     { title: 'Welcome email', data: () => fetch('/templates/welcome').then(r => r.text()) }
 *   ]
 *
 * Templates may contain merge fields. An empty document is replaced; otherwise the template is
 * inserted at the selection.
 */

import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';

export interface ContentTemplate {
  title: string;
  description?: string;
  /** HTML, or a function returning it (sync or async, e.g. loaded from the server). */
  data: string | (() => string | Promise<string>);
}

export class InsertTemplateCommand extends Command {
  public override refresh(): void {
    this.isEnabled = ((this.editor.config.get('templates') as ContentTemplate[] | undefined) || []).length > 0;
  }

  /** Inserts the template with the given title (or index). Resolves once it is in the document. */
  public override async execute(options: { title?: string; index?: number } = {}): Promise<void> {
    const editor = this.editor;
    const templates = (editor.config.get('templates') as ContentTemplate[] | undefined) || [];
    const template = options.title !== undefined ? templates.find(item => item.title === options.title) : templates[options.index ?? 0];
    if (!template) return;
    const html = typeof template.data === 'function' ? await template.data() : template.data;
    const model = editor.model;
    const root = model.document.getRoot()!;
    const isEmpty = root.childCount === 0 || (root.childCount === 1 && (root.getChild(0) as any).isEmpty);
    model.change(writer => {
      const fragment = editor.data.parse(html);
      if (isEmpty) {
        writer.remove(writer.createRangeIn(root));
        writer.insert(fragment, root, 0);
        writer.setSelection(root, 0);
      } else {
        model.insertContent(fragment);
      }
    });
  }
}

export class Templates extends Plugin {
  public static override get pluginName(): string {
    return 'Templates';
  }

  public override init(): void {
    const editor = this.editor;
    const t = editor.t;
    editor.commands.add('insertTemplate', new InsertTemplateCommand(editor));
    const templates = (editor.config.get('templates') as ContentTemplate[] | undefined) || [];
    if (!templates.length) return;
    editor.ui.componentFactory.add('insertTemplate', locale => {
      const command = editor.commands.get('insertTemplate')!;
      const dropdown = createDropdown(locale);
      dropdown.buttonView.set({ label: t('Templates'), icon: icons.template, tooltip: true });
      dropdown.bind('isEnabled').to(command);
      addListToDropdown(
        dropdown,
        () => {
          const items = new Collection<ListDropdownItemDefinition>();
          templates.forEach((template, index) => {
            const model = new Observable() as any;
            model.set({ label: template.title, withText: true, templateIndex: index, tooltip: template.description || false, role: 'menuitem' });
            items.add({ type: 'button', model });
          });
          return items;
        },
        { role: 'menu', ariaLabel: t('Templates') }
      );
      this.listenTo(dropdown, 'execute', (evt: any) => {
        void (editor.execute('insertTemplate', { index: evt.source.templateIndex }) as unknown as Promise<void>);
        editor.editing.view.focus();
      });
      return dropdown;
    });
  }
}
