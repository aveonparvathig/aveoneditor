import { Plugin } from '../../core/plugin';
import { ListCommand, IndentListCommand, CheckTodoListCommand } from './listcommands';
import { fixListStructureIn, isListItemView } from './liststructure';
import { Enter } from '../enter/enter';
import { Delete } from '../typing/delete';
import { Paragraph } from '../paragraph/paragraph';
import type { Editor } from '../../core/editor';
import type { Element as ModelElement } from '../../engine/model/element';
import type { Element as ViewElement } from '../../engine/view/element';
import type { DowncastWriter } from '../../engine/view/downcastwriter';
import type { UpcastConversionApi, UpcastConversionData } from '../../engine/conversion/upcastdispatcher';
import type { DowncastConversionApi, DowncastInsertEvent } from '../../engine/conversion/downcastdispatcher';
import type { EventInfo } from '../../utils/eventinfo';
import { keyCodes, parseKeystroke } from '../../utils/keyboard';

/**
 * List editing: flat `listItem` model elements with `listType` and `listIndent`
 * rendered as nested `<ul>`/`<ol>` lists. Includes to-do lists.
 */
export class ListEditing extends Plugin {
  public static override get pluginName(): string {
    return 'ListEditing';
  }

  public static override get requires() {
    return [Enter, Delete, Paragraph];
  }

  public override init(): void {
    const editor = this.editor;
    const model = editor.model;
    const schema = model.schema;

    schema.register('listItem', { inheritAllFrom: '$block', allowAttributes: ['listType', 'listIndent', 'todoListChecked'] });

    editor.conversion.for('editingDowncast').add(dispatcher => dispatcher.on('insert:listItem', insertListItem(editor, true)));
    editor.conversion.for('dataDowncast').add(dispatcher => dispatcher.on('insert:listItem', insertListItem(editor, false)));
    editor.conversion.for('upcast').add(dispatcher => dispatcher.on('element:li', upcastListItem()));

    // Keep <ul>/<ol> wrappers in sync for the editing view.
    editor.editing.view.document.registerPostFixer(writer => {
      let changed = false;
      for (const root of editor.editing.view.document.roots) {
        if (fixListStructureIn(root, editor.editing.mapper)) changed = true;
      }
      void writer;
      return changed;
    });
    // ...and for the data output.
    this.listenTo(editor.data, 'toView', (evt: EventInfo) => {
      const fragment = evt.return as any;
      if (fragment) fixListStructureIn(fragment, editor.data.mapper);
    }, { priority: 'low' });

    // Model post-fixer: normalise indents and attributes.
    model.document.registerPostFixer(writer => modelChangePostFixer(model, writer));

    editor.commands.add('numberedList', new ListCommand(editor, 'numbered'));
    editor.commands.add('bulletedList', new ListCommand(editor, 'bulleted'));
    editor.commands.add('todoList', new ListCommand(editor, 'todo'));
    editor.commands.add('checkTodoList', new CheckTodoListCommand(editor));
    editor.commands.add('indentList', new IndentListCommand(editor, 'forward'));
    editor.commands.add('outdentList', new IndentListCommand(editor, 'backward'));

    const viewDocument = editor.editing.view.document;

    // Tab / Shift+Tab inside a list item.
    this.listenTo(viewDocument, 'tab', (evt, data: any) => {
      const commandName = data.shiftKey ? 'outdentList' : 'indentList';
      const command = editor.commands.get(commandName)!;
      if (command.isEnabled) {
        editor.execute(commandName);
        data.stopPropagation();
        data.preventDefault();
        evt.stop();
      }
    }, { context: 'li' });

    // Enter in an empty list item outdents it.
    this.listenTo(viewDocument, 'enter', (evt, data: any) => {
      const doc = model.document;
      const positionParent = doc.selection.getLastPosition()!.parent as ModelElement;
      if (doc.selection.isCollapsed && positionParent.is('element', 'listItem') && positionParent.isEmpty) {
        editor.execute('outdentList');
        data.preventDefault();
        evt.stop();
      }
    }, { context: 'li' });

    // Backspace at the start of a list item outdents it.
    this.listenTo(viewDocument, 'delete', (evt, data: any) => {
      if (data.direction !== 'backward') return;
      const selection = model.document.selection;
      if (!selection.isCollapsed) return;
      const firstPosition = selection.getFirstPosition()!;
      if (!firstPosition.isAtStart) return;
      const positionParent = firstPosition.parent as ModelElement;
      if (!positionParent.is('element', 'listItem')) return;
      editor.execute('outdentList');
      data.preventDefault();
      evt.stop();
    }, { context: 'li' });

    // Ctrl+Enter toggles to-do items.
    this.listenTo(viewDocument, 'keydown', (evt, data: any) => {
      if (data.keystroke === parseKeystroke('Ctrl+Enter')) {
        const command = editor.commands.get('checkTodoList')!;
        if (command.isEnabled) {
          editor.execute('checkTodoList');
          data.preventDefault();
          evt.stop();
        }
      }
    });

    // Map positions inside to-do items into the description span.
    editor.editing.mapper.on('modelToViewPosition', mapModelToViewPositionInTodo(editor.editing.view), { priority: 'high' });
    editor.data.mapper.on('modelToViewPosition', mapModelToViewPositionInTodo(null), { priority: 'high' });
  }

  public override afterInit(): void {
    const commands = this.editor.commands;
    const indent = commands.get('indent') as any;
    const outdent = commands.get('outdent') as any;
    if (indent && typeof indent.registerChildCommand === 'function') {
      indent.registerChildCommand(commands.get('indentList'));
    }
    if (outdent && typeof outdent.registerChildCommand === 'function') {
      outdent.registerChildCommand(commands.get('outdentList'));
    }
  }
}

function insertListItem(editor: Editor, isEditing: boolean) {
  return (evt: EventInfo, data: DowncastInsertEvent, conversionApi: DowncastConversionApi): void => {
    if (!conversionApi.consumable.consume(data.item, 'insert')) return;
    const writer = conversionApi.writer;
    const mapper = conversionApi.mapper;
    const modelItem = data.item as ModelElement;
    const li = writer.createContainerElement('li');
    const viewPosition = mapper.toViewPosition(data.range.start);
    writer.insert(viewPosition, li);
    mapper.bindElements(modelItem, li);

    if (modelItem.getAttribute('listType') === 'todo') {
      const checked = !!modelItem.getAttribute('todoListChecked');
      const label = writer.createAttributeElement('label', { class: 'todo-list__label' }, { priority: 1 });
      const description = writer.createContainerElement('span', { class: 'todo-list__label__description' });
      writer.setCustomProperty('todoDescription', true, description);
      let checkbox: ViewElement;
      if (isEditing) {
        checkbox = writer.createUIElement('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) }, function (domDocument) {
          const domElement = this.toDomElement(domDocument);
          domElement.addEventListener('change', () => {
            editor.model.change(() => {
              editor.execute('checkTodoList', { forceValue: !checked, selection: editor.model.createSelection(modelItem, 'on') });
            });
          });
          return domElement;
        });
      } else {
        checkbox = writer.createEmptyElement('input', { type: 'checkbox', disabled: 'disabled', ...(checked ? { checked: 'checked' } : {}) });
      }
      // The label wraps the checkbox and the description. Build manually to avoid attribute-element merging rules.
      const labelContainer = writer.createContainerElement('label', { class: 'todo-list__label' });
      void label;
      writer.insert(writer.createPositionAt(li, 0), labelContainer);
      writer.insert(writer.createPositionAt(labelContainer, 0), checkbox);
      writer.insert(writer.createPositionAt(labelContainer, 'end'), description);
      writer.setCustomProperty('todoItem', true, li);
    }

    conversionApi.convertAttributes(modelItem);
    conversionApi.convertChildren(modelItem);
  };
}

function mapModelToViewPositionInTodo(view: any) {
  void view;
  return (evt: EventInfo, data: any): void => {
    if (data.viewPosition) return;
    const modelPosition = data.modelPosition;
    const parent = modelPosition.parent;
    if (!parent || !parent.is || !parent.is('element', 'listItem') || parent.getAttribute('listType') !== 'todo') return;
    const viewLi = data.mapper.toViewElement(parent);
    if (!viewLi) return;
    const label = Array.from(viewLi.getChildren()).find((child: any) => child.is('element', 'label')) as ViewElement | undefined;
    if (!label) return;
    const description = Array.from(label.getChildren()).find((child: any) => child.getCustomProperty && child.getCustomProperty('todoDescription')) as ViewElement | undefined;
    if (!description) return;
    data.viewPosition = data.mapper.findPositionIn(description, modelPosition.offset);
  };
}

function upcastListItem() {
  return (evt: EventInfo, data: UpcastConversionData, conversionApi: UpcastConversionApi): void => {
    const viewItem = data.viewItem as ViewElement;
    if (!conversionApi.consumable.test(viewItem as any, { name: true })) return;
    const writer = conversionApi.writer;
    const listItem = writer.createElement('listItem');
    const indent = getIndent(viewItem);
    const type = getListType(viewItem);
    listItem._setAttribute('listIndent', indent);
    listItem._setAttribute('listType', type);
    if (type === 'todo' && isChecked(viewItem)) {
      listItem._setAttribute('todoListChecked', true);
    }
    if (!conversionApi.safeInsert(listItem, data.modelCursor)) return;
    conversionApi.consumable.consume(viewItem as any, { name: true });

    let position = writer.createPositionAt(listItem, 0);
    const convertChildrenInline = (element: ViewElement) => {
      for (const child of Array.from(element.getChildren())) {
        const result = conversionApi.convertItem(child, position);
        if (result.modelRange) position = result.modelCursor;
      }
    };
    for (const child of Array.from(viewItem.getChildren())) {
      const c = child as any;
      if (c.is('element') && (c.name === 'p' || c.name === 'div')) {
        conversionApi.consumable.consume(c, { name: true });
        convertChildrenInline(c);
      } else if (c.is('element', 'label') && c.hasClass('todo-list__label')) {
        conversionApi.consumable.consume(c, { name: true });
        for (const labelChild of Array.from(c.getChildren()) as any[]) {
          if (labelChild.is('element', 'input')) {
            conversionApi.consumable.consume(labelChild, { name: true });
          } else if (labelChild.is('element', 'span')) {
            conversionApi.consumable.consume(labelChild, { name: true });
            convertChildrenInline(labelChild);
          } else {
            const result = conversionApi.convertItem(labelChild, position);
            if (result.modelRange) position = result.modelCursor;
          }
        }
      } else if (c.is('element', 'input') && c.getAttribute('type') === 'checkbox') {
        conversionApi.consumable.consume(c, { name: true });
      } else {
        const result = conversionApi.convertItem(child, position);
        if (result.modelRange) position = result.modelCursor;
      }
    }
    conversionApi.updateConversionResult(listItem, data);
    // Nested lists split the item: the cursor continues after everything that was converted.
    if (position.parent !== listItem && data.modelRange && position.isAfter(data.modelRange.end)) {
      data.modelRange = writer.createRange(data.modelRange.start, position);
      data.modelCursor = position;
    }
  };
}

function getIndent(viewLi: ViewElement): number {
  let indent = 0;
  let parent: any = viewLi.parent;
  while (parent) {
    if (parent.is && parent.is('element', 'li')) indent++;
    parent = parent.parent;
  }
  return indent;
}

function getListType(viewLi: ViewElement): string {
  let parent: any = viewLi.parent;
  while (parent) {
    if (parent.is && parent.is('element', 'ol')) return 'numbered';
    if (parent.is && parent.is('element', 'ul')) {
      return parent.hasClass('todo-list') || hasCheckbox(viewLi) ? 'todo' : 'bulleted';
    }
    parent = parent.parent;
  }
  return hasCheckbox(viewLi) ? 'todo' : 'bulleted';
}

function hasCheckbox(viewLi: ViewElement): boolean {
  for (const child of viewLi.getChildren()) {
    const c = child as any;
    if (c.is('element', 'input') && c.getAttribute('type') === 'checkbox') return true;
    if (c.is('element', 'label')) {
      for (const labelChild of c.getChildren()) {
        if ((labelChild as any).is('element', 'input') && (labelChild as any).getAttribute('type') === 'checkbox') return true;
      }
    }
  }
  return false;
}

function isChecked(viewLi: ViewElement): boolean {
  const find = (el: ViewElement): boolean => {
    for (const child of el.getChildren()) {
      const c = child as any;
      if (c.is('element', 'input') && c.getAttribute('type') === 'checkbox') return c.hasAttribute('checked');
      if (c.is('element', 'label') && find(c)) return true;
    }
    return false;
  };
  return find(viewLi);
}

function modelChangePostFixer(model: any, writer: any): boolean {
  const changes = model.document.differ.getChanges();
  const containersToCheck = new Set<any>();
  for (const entry of changes) {
    if (entry.type === 'insert' || entry.type === 'refresh' || entry.type === 'remove') {
      const parent = entry.position.parent;
      if (parent) containersToCheck.add(parent);
      if (entry.node && entry.node.is && entry.node.is('element')) {
        for (const descendant of model.createRangeIn(entry.node).getItems()) {
          if (descendant.is && descendant.is('element', 'listItem')) {
            containersToCheck.add(descendant.parent);
          } else if (descendant.is && descendant.is('element') && Array.from(descendant.getChildren()).some((c: any) => c.is('element', 'listItem'))) {
            containersToCheck.add(descendant);
          }
        }
      }
    }
  }
  let applied = false;
  for (const container of containersToCheck) {
    if (!container || !container.getChildren) continue;
    let prevIndent = -1;
    let prevType: string | null = null;
    for (const child of container.getChildren()) {
      if (child.is('element', 'listItem')) {
        let indent = child.getAttribute('listIndent');
        let type = child.getAttribute('listType');
        if (typeof indent !== 'number') {
          indent = 0;
          writer.setAttribute('listIndent', 0, child);
          applied = true;
        }
        if (!type) {
          type = prevType || 'bulleted';
          writer.setAttribute('listType', type, child);
          applied = true;
        }
        if (indent > prevIndent + 1) {
          indent = prevIndent + 1;
          writer.setAttribute('listIndent', indent, child);
          applied = true;
        }
        if (type !== 'todo' && child.hasAttribute('todoListChecked')) {
          writer.removeAttribute('todoListChecked', child);
          applied = true;
        }
        prevIndent = indent;
        prevType = type;
      } else {
        prevIndent = -1;
        prevType = null;
      }
    }
  }
  return applied;
}

export { isListItemView, keyCodes };
export type { DowncastWriter };
