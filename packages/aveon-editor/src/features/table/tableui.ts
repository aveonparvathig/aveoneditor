import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { ButtonView } from '../../ui/button/buttonview';
import { createDropdown, addListToDropdown, type ListDropdownItemDefinition } from '../../ui/dropdown/dropdownview';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import { icons } from '../../ui/icons';
import type { Locale } from '../../utils/locale';

/** The 10x10 grid used to pick the table size. */
export class InsertTableView extends View {
  public readonly items = this.createCollection();
  declare public rows: number;
  declare public columns: number;
  declare public label: string;

  constructor(locale: Locale) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('rows', 0);
    this.set('columns', 0);
    this.bind('label').to(this, 'columns', this, 'rows', (columns: number, rows: number) => `${rows} × ${columns}`);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck'] },
      children: [
        { tag: 'div', attributes: { class: ['ck-insert-table-dropdown__grid'] }, children: this.items },
        { tag: 'div', attributes: { class: ['ck-insert-table-dropdown__label'], 'aria-hidden': true }, children: [{ text: bind.to('label') }] }
      ],
      on: {
        mousedown: bind.to((evt: Event) => evt.preventDefault()),
        click: bind.to(() => this.fire('execute'))
      }
    });
    for (let index = 0; index < 100; index++) {
      const row = Math.floor(index / 10);
      const column = index % 10;
      const boxView = new TableSizeGridBoxView(locale, row + 1, column + 1);
      boxView.on('boxover', () => {
        this.set({ rows: row + 1, columns: column + 1 });
      });
      this.items.add(boxView);
    }
    this.on('change:columns', () => this._highlightGridBoxes());
    this.on('change:rows', () => this._highlightGridBoxes());
  }

  public reset(): void {
    this.set({ rows: 1, columns: 1 });
  }

  public focus(): void {
    /* grid is mouse only */
  }

  public focusLast(): void {
    /* grid is mouse only */
  }

  private _highlightGridBoxes(): void {
    const rows = this.rows;
    const columns = this.columns;
    this.items.map((boxView: any, index) => {
      const itemRow = Math.floor(index / 10);
      const itemColumn = index % 10;
      boxView.set('isOn', itemRow < rows && itemColumn < columns);
    });
  }
}

class TableSizeGridBoxView extends View {
  declare public isOn: boolean;

  constructor(locale: Locale, row: number, column: number) {
    super(locale);
    const bind = this.bindTemplate;
    this.set('isOn', false);
    this.setTemplate({
      tag: 'div',
      attributes: { class: ['ck-insert-table-dropdown-grid-box', bind.if('isOn', 'ck-on')], 'data-row': row, 'data-column': column },
      on: { mouseover: bind.to('boxover') }
    });
  }
}

/** Table toolbar buttons and dropdowns. */
export class TableUI extends Plugin {
  public static override get pluginName(): string {
    return 'TableUI';
  }

  public override init(): void {
    const editor = this.editor;
    const t = this.editor.t;
    const contentLanguageDirection = editor.locale.contentLanguageDirection;
    const isContentLtr = contentLanguageDirection === 'ltr';

    editor.ui.componentFactory.add('insertTable', locale => {
      const command = editor.commands.get('insertTable')!;
      const dropdownView = createDropdown(locale);
      dropdownView.bind('isEnabled').to(command);
      dropdownView.buttonView.set({ icon: icons.table, label: t('Insert table'), tooltip: true });
      let insertTableView: InsertTableView;
      dropdownView.on('change:isOpen', () => {
        if (insertTableView) return;
        insertTableView = new InsertTableView(locale);
        dropdownView.panelView.children.add(insertTableView);
        insertTableView.delegate('execute').to(dropdownView);
        dropdownView.on('execute', () => {
          editor.execute('insertTable', { rows: insertTableView.rows, columns: insertTableView.columns });
          editor.editing.view.focus();
        });
      });
      return dropdownView;
    });

    editor.ui.componentFactory.add('tableColumn', locale => {
      const options: any[] = [
        { type: 'switchbutton', model: { commandName: 'setTableColumnHeader', label: t('Header column'), bindIsOn: true } },
        { type: 'separator' },
        { type: 'button', model: { commandName: isContentLtr ? 'insertTableColumnLeft' : 'insertTableColumnRight', label: t('Insert column left') } },
        { type: 'button', model: { commandName: isContentLtr ? 'insertTableColumnRight' : 'insertTableColumnLeft', label: t('Insert column right') } },
        { type: 'button', model: { commandName: 'removeTableColumn', label: t('Delete column') } }
      ];
      return this._prepareDropdown(t('Column'), icons.tableColumn, options, locale);
    });

    editor.ui.componentFactory.add('tableRow', locale => {
      const options: any[] = [
        { type: 'switchbutton', model: { commandName: 'setTableRowHeader', label: t('Header row'), bindIsOn: true } },
        { type: 'separator' },
        { type: 'button', model: { commandName: 'insertTableRowAbove', label: t('Insert row above') } },
        { type: 'button', model: { commandName: 'insertTableRowBelow', label: t('Insert row below') } },
        { type: 'button', model: { commandName: 'removeTableRow', label: t('Delete row') } }
      ];
      return this._prepareDropdown(t('Row'), icons.tableRow, options, locale);
    });
  }

  private _prepareDropdown(label: string, icon: string, options: any[], locale: Locale): any {
    const editor = this.editor;
    const dropdownView = createDropdown(locale);
    const commands: any[] = [];
    const itemDefinitions = new Collection<ListDropdownItemDefinition>();
    for (const option of options) {
      addListOption(option, editor, commands, itemDefinitions);
    }
    addListToDropdown(dropdownView, itemDefinitions, { ariaLabel: label, role: 'menu' });
    dropdownView.buttonView.set({ label, icon, tooltip: true });
    dropdownView.bind('isEnabled').toMany(commands, 'isEnabled', (...areEnabled: boolean[]) => areEnabled.some(isEnabled => isEnabled));
    this.listenTo(dropdownView, 'execute', (evt: any) => {
      editor.execute(evt.source.commandName);
      if (evt.source.commandName !== 'mergeTableCells') {
        editor.editing.view.focus();
      }
    });
    return dropdownView;
  }
}

function addListOption(option: any, editor: any, commands: any[], itemDefinitions: Collection<ListDropdownItemDefinition>): void {
  if (option.type === 'button' || option.type === 'switchbutton') {
    const model = new Observable() as any;
    const { commandName, bindIsOn } = option.model;
    const command = editor.commands.get(commandName);
    commands.push(command);
    model.set({ commandName, label: option.model.label, withText: true, role: 'menuitem' });
    model.bind('isEnabled').to(command);
    if (bindIsOn) model.bind('isOn').to(command, 'value');
    itemDefinitions.add({ type: option.type, model });
  } else {
    itemDefinitions.add({ type: option.type });
  }
}

export { ButtonView };
