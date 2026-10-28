import { Plugin } from '../../core/plugin';
import { Command } from '../../core/command';
import { createLinkElement, ensureSafeUrl, findAttributeRange, isLinkElement, addLinkProtocolIfApplicable, isEmail } from './utils';
import { first, toMap } from '../../utils/misc';
import { Collection } from '../../utils/collection';
import { Observable } from '../../utils/observable';
import type { Editor } from '../../core/editor';
import type { Element } from '../../engine/model/element';
import type { Range } from '../../engine/model/range';
import type { Item } from '../../engine/model/item';

const DECORATOR_AUTOMATIC = 'automatic';
const DECORATOR_MANUAL = 'manual';
const EXTERNAL_LINKS_REGEXP = /^(https?:)?\/\//;

export interface LinkDecoratorDefinition {
  mode: 'automatic' | 'manual';
  label?: string;
  attributes?: Record<string, string>;
  classes?: string | string[];
  styles?: Record<string, string>;
  callback?: (url: string | null) => boolean;
  defaultValue?: boolean;
}

/** Observable model of a manual decorator (e.g. "Open in a new tab"). */
export class ManualDecorator extends Observable {
  public readonly id: string;
  public readonly label: string;
  public readonly attributes?: Record<string, string>;
  public readonly classes?: string | string[];
  public readonly styles?: Record<string, string>;
  public readonly defaultValue?: boolean;
  declare public value: boolean | undefined;

  constructor({ id, label, attributes, classes, styles, defaultValue }: { id: string; label: string; attributes?: Record<string, string>; classes?: string | string[]; styles?: Record<string, string>; defaultValue?: boolean }) {
    super();
    this.id = id;
    this.set('value', undefined);
    this.defaultValue = defaultValue;
    this.label = label;
    this.attributes = attributes;
    this.classes = classes;
    this.styles = styles;
  }

  public _createPattern(): any {
    return { attributes: this.attributes, classes: this.classes, styles: this.styles };
  }
}

/** Creates or edits a link on the selection. */
export class LinkCommand extends Command {
  public readonly manualDecorators = new Collection<ManualDecorator>();

  public restoreManualDecoratorStates(): void {
    for (const manualDecorator of this.manualDecorators) {
      manualDecorator.value = this._getDecoratorStateFromModel(manualDecorator.id);
    }
  }

  public override refresh(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selectedElement = selection.getSelectedElement() || first(selection.getSelectedBlocks());
    if (selectedElement && model.schema.checkAttribute(selectedElement as any, 'linkHref') && isLinkableElement(selectedElement, model.schema)) {
      this.value = selectedElement.getAttribute('linkHref');
      this.isEnabled = true;
    } else {
      this.value = selection.getAttribute('linkHref');
      this.isEnabled = model.schema.checkAttributeInSelection(selection, 'linkHref');
    }
    for (const manualDecorator of this.manualDecorators) {
      manualDecorator.value = this._getDecoratorStateFromModel(manualDecorator.id);
    }
  }

  public override execute(href: string, manualDecoratorIds: Record<string, boolean> = {}): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const truthyManualDecorators: string[] = [];
    const falsyManualDecorators: string[] = [];
    for (const name in manualDecoratorIds) {
      if (manualDecoratorIds[name]) truthyManualDecorators.push(name);
      else falsyManualDecorators.push(name);
    }

    model.change(writer => {
      if (selection.isCollapsed) {
        const position = selection.getFirstPosition()!;
        if (selection.hasAttribute('linkHref')) {
          const linkText = extractTextFromSelection(selection as any);
          let linkRange = findAttributeRange(position, 'linkHref', selection.getAttribute('linkHref'), model);
          if (selection.getAttribute('linkHref') === linkText) {
            linkRange = this._updateLinkContent(model, writer, linkRange, href);
          }
          writer.setAttribute('linkHref', href, linkRange);
          truthyManualDecorators.forEach(item => writer.setAttribute(item, true, linkRange));
          falsyManualDecorators.forEach(item => writer.removeAttribute(item, linkRange));
          writer.setSelection(writer.createPositionAfter(linkRange.end.nodeBefore!));
        } else if (href !== '') {
          const attributes = toMap(selection.getAttributes() as any);
          attributes.set('linkHref', href);
          truthyManualDecorators.forEach(item => attributes.set(item, true));
          const { end: positionAfter } = model.insertContent(writer.createText(href, attributes as any), position);
          writer.setSelection(positionAfter);
        }
        ['linkHref', ...truthyManualDecorators, ...falsyManualDecorators].forEach(item => writer.removeSelectionAttribute(item));
      } else {
        const ranges = model.schema.getValidRanges(selection.getRanges(), 'linkHref');
        const allowedRanges: Range[] = [];
        for (const element of selection.getSelectedBlocks()) {
          if (model.schema.checkAttribute(element, 'linkHref')) {
            allowedRanges.push(writer.createRangeOn(element));
          }
        }
        const rangesToUpdate = allowedRanges.slice();
        for (const range of ranges) {
          if (this._isRangeToUpdate(range, allowedRanges)) rangesToUpdate.push(range);
        }
        for (const range of rangesToUpdate) {
          let linkRange = range;
          if (rangesToUpdate.length === 1) {
            const linkText = extractTextFromSelection(selection as any);
            if (selection.getAttribute('linkHref') === linkText) {
              linkRange = this._updateLinkContent(model, writer, range, href);
              writer.setSelection(writer.createSelection(linkRange));
            }
          }
          writer.setAttribute('linkHref', href, linkRange);
          truthyManualDecorators.forEach(item => writer.setAttribute(item, true, linkRange));
          falsyManualDecorators.forEach(item => writer.removeAttribute(item, linkRange));
        }
      }
    });
  }

  private _getDecoratorStateFromModel(decoratorName: string): boolean | undefined {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selectedElement = selection.getSelectedElement();
    if (selectedElement && model.schema.checkAttribute(selectedElement as any, 'linkHref')) {
      return selectedElement.getAttribute(decoratorName) as boolean | undefined;
    }
    return selection.getAttribute(decoratorName) as boolean | undefined;
  }

  private _isRangeToUpdate(range: Range, allowedRanges: Range[]): boolean {
    for (const allowedRange of allowedRanges) {
      if (allowedRange.containsRange(range)) return false;
    }
    return true;
  }

  private _updateLinkContent(model: any, writer: any, range: Range, href: string): Range {
    const text = writer.createText(href, { linkHref: href });
    return model.insertContent(text, range);
  }
}

function extractTextFromSelection(selection: any): string | null {
  if (selection.isCollapsed) {
    const firstPosition = selection.getFirstPosition();
    return firstPosition.textNode && firstPosition.textNode.data;
  }
  const rangeItems = Array.from(selection.getFirstRange().getItems());
  if (rangeItems.length > 1) return null;
  const firstNode = rangeItems[0] as any;
  if (firstNode.is('$text') || firstNode.is('$textProxy')) return firstNode.data;
  return null;
}

function isLinkableElement(element: any, schema: any): boolean {
  if (!element) return false;
  return element.is('element', 'imageBlock') || element.is('element', 'imageInline') || schema.checkAttribute(element, 'linkHref');
}

/** Removes the link from the selection. */
export class UnlinkCommand extends Command {
  public override refresh(): void {
    const model = this.editor.model;
    const selection = model.document.selection;
    const selectedElement = selection.getSelectedElement();
    if (selectedElement && isLinkableElement(selectedElement, model.schema)) {
      this.isEnabled = model.schema.checkAttribute(selectedElement as any, 'linkHref');
    } else {
      this.isEnabled = model.schema.checkAttributeInSelection(selection, 'linkHref');
    }
  }

  public override execute(): void {
    const editor = this.editor;
    const model = editor.model;
    const selection = model.document.selection;
    const linkCommand = editor.commands.get('link') as LinkCommand | undefined;
    model.change(writer => {
      const rangesToUnlink = selection.isCollapsed ? [findAttributeRange(selection.getFirstPosition()!, 'linkHref', selection.getAttribute('linkHref'), model)] : model.schema.getValidRanges(selection.getRanges(), 'linkHref');
      for (const range of rangesToUnlink) {
        writer.removeAttribute('linkHref', range);
        if (linkCommand) {
          for (const manualDecorator of linkCommand.manualDecorators) {
            writer.removeAttribute(manualDecorator.id, range);
          }
        }
      }
    });
  }
}

/** Link editing: schema, converters, commands, decorators and caret behaviour at link boundaries. */
export class LinkEditing extends Plugin {
  public static override get pluginName(): string {
    return 'LinkEditing';
  }

  constructor(editor: Editor) {
    super(editor);
    editor.config.define('link', { addTargetToExternalLinks: false, defaultProtocol: undefined, decorators: {} });
  }

  public override init(): void {
    const editor = this.editor;
    const allowedProtocols = editor.config.get('link.allowedProtocols') as string[] | undefined;

    editor.model.schema.extend('$text', { allowAttributes: 'linkHref' });

    editor.conversion.for('dataDowncast').attributeToElement({ model: 'linkHref', view: (href, conversionApi) => createLinkElement(String(href), conversionApi) });
    editor.conversion.for('editingDowncast').attributeToElement({ model: 'linkHref', view: (href, conversionApi) => createLinkElement(ensureSafeUrl(href, allowedProtocols), conversionApi) });
    editor.conversion.for('upcast').elementToAttribute({
      view: { name: 'a', attributes: { href: true } },
      model: { key: 'linkHref', value: (viewElement: any) => viewElement.getAttribute('href') }
    });

    editor.commands.add('link', new LinkCommand(editor));
    editor.commands.add('unlink', new UnlinkCommand(editor));

    const linkDecorators = getLocalizedDecorators(editor.t, normalizeDecorators(editor.config.get('link.decorators') as Record<string, LinkDecoratorDefinition>));
    this._enableAutomaticDecorators(linkDecorators.filter((item): item is any => item.mode === DECORATOR_AUTOMATIC));
    this._enableManualDecorators(linkDecorators.filter((item): item is any => item.mode === DECORATOR_MANUAL));

    this._enableLinkBoundaryHandling();
    this._enableClickingAfterLink();
  }

  private _enableAutomaticDecorators(automaticDecoratorDefinitions: any[]): void {
    const editor = this.editor;
    const command = editor.commands.get('link') as LinkCommand;
    const decorators: any[] = [...automaticDecoratorDefinitions];
    if (editor.config.get('link.addTargetToExternalLinks')) {
      decorators.push({
        id: 'linkIsExternal',
        mode: DECORATOR_AUTOMATIC,
        callback: (url: string | null) => !!url && EXTERNAL_LINKS_REGEXP.test(url),
        attributes: { target: '_blank', rel: 'noopener noreferrer' }
      });
    }
    void command;
    if (decorators.length) {
      editor.conversion.for('downcast').add(dispatcher => {
        dispatcher.on('attribute:linkHref', (evt: any, data: any, conversionApi: any) => {
          if (!conversionApi.consumable.test(data.item, 'attribute:linkHref')) return;
          const viewWriter = conversionApi.writer;
          const viewSelection = viewWriter.document.selection;
          for (const item of decorators) {
            const viewElement = viewWriter.createAttributeElement('a', item.attributes, { priority: 5 });
            if (item.classes) viewWriter.addClass(item.classes, viewElement);
            for (const key in item.styles || {}) viewWriter.setStyle(key, item.styles[key], viewElement);
            viewWriter.setCustomProperty('link', true, viewElement);
            if (item.callback(data.attributeNewValue)) {
              if (data.item.is('selection')) {
                viewWriter.wrap(viewSelection.getFirstRange(), viewElement);
              } else {
                viewWriter.wrap(conversionApi.mapper.toViewRange(data.range), viewElement);
              }
            } else {
              viewWriter.unwrap(conversionApi.mapper.toViewRange(data.range), viewElement);
            }
          }
        }, { priority: 'high' });
      });
    }
  }

  private _enableManualDecorators(manualDecoratorDefinitions: any[]): void {
    if (!manualDecoratorDefinitions.length) return;
    const editor = this.editor;
    const command = editor.commands.get('link') as LinkCommand;
    const manualDecorators = command.manualDecorators;
    manualDecoratorDefinitions.forEach(decoratorDefinition => {
      editor.model.schema.extend('$text', { allowAttributes: decoratorDefinition.id });
      const decorator = new ManualDecorator(decoratorDefinition);
      manualDecorators.add(decorator);
      editor.conversion.for('downcast').attributeToElement({
        model: decorator.id,
        view: (manualDecoratorValue, { writer }) => {
          if (manualDecoratorValue) {
            const element = writer.createAttributeElement('a', decorator.attributes, { priority: 5 });
            if (decorator.classes) writer.addClass(decorator.classes, element);
            for (const key in decorator.styles || {}) writer.setStyle(key, decorator.styles![key], element);
            writer.setCustomProperty('link', true, element);
            return element;
          }
          return null;
        }
      });
      editor.conversion.for('upcast').elementToAttribute({
        view: { name: 'a', ...decorator._createPattern() },
        model: { key: decorator.id }
      });
    });
  }

  /** Typing right after or before a link does not extend it. */
  private _enableLinkBoundaryHandling(): void {
    const editor = this.editor;
    const model = editor.model;
    const selection = model.document.selection;
    const linkCommand = editor.commands.get('link') as LinkCommand;
    const attributes = ['linkHref', ...Array.from(linkCommand.manualDecorators).map(d => d.id)];

    this.listenTo(selection, 'change:range', (evt, data: any) => {
      if (!data.directChange) return;
      if (!selection.isCollapsed) return;
      const position = selection.getFirstPosition()!;
      if (position.textNode) return;
      const nodeBefore: any = position.nodeBefore;
      const nodeAfter: any = position.nodeAfter;
      const beforeHref = nodeBefore && nodeBefore.is('$text') ? nodeBefore.getAttribute('linkHref') : undefined;
      const afterHref = nodeAfter && nodeAfter.is('$text') ? nodeAfter.getAttribute('linkHref') : undefined;
      if (beforeHref !== undefined && afterHref !== beforeHref && selection.hasAttribute('linkHref')) {
        model.enqueueChange({ isUndoable: false }, writer => {
          writer.removeSelectionAttribute(attributes);
        });
      }
    });
  }

  private _enableClickingAfterLink(): void {
    const editor = this.editor;
    const model = editor.model;
    this.listenTo(editor.editing.view.document, 'mousedown', () => {
      // Placing the caret at the end of a link should not keep the link attribute.
      setTimeout(() => {
        const selection = model.document.selection;
        if (!selection.isCollapsed || !selection.hasAttribute('linkHref')) return;
        const position = selection.getFirstPosition()!;
        const nodeAfter: any = position.nodeAfter;
        if (!position.textNode && (!nodeAfter || !nodeAfter.is('$text') || nodeAfter.getAttribute('linkHref') !== selection.getAttribute('linkHref'))) {
          model.enqueueChange({ isUndoable: false }, writer => writer.removeSelectionAttribute('linkHref'));
        }
      }, 0);
    });
  }
}

export function normalizeDecorators(decorators: Record<string, LinkDecoratorDefinition> | undefined): Array<LinkDecoratorDefinition & { id: string }> {
  const retArray: Array<LinkDecoratorDefinition & { id: string }> = [];
  if (decorators) {
    for (const [key, value] of Object.entries(decorators)) {
      const decorator = Object.assign({}, value, { id: `link${key[0].toUpperCase() + key.slice(1)}` });
      retArray.push(decorator);
    }
  }
  return retArray;
}

export function getLocalizedDecorators(t: any, decorators: Array<LinkDecoratorDefinition & { id: string }>): Array<LinkDecoratorDefinition & { id: string }> {
  const localizedDecoratorsLabels: Record<string, string> = { 'Open in a new tab': t('Open in a new tab'), Downloadable: t('Downloadable') };
  decorators.forEach(decorator => {
    if ('label' in decorator && decorator.label && localizedDecoratorsLabels[decorator.label]) {
      decorator.label = localizedDecoratorsLabels[decorator.label];
    }
  });
  return decorators;
}

export { isLinkElement, addLinkProtocolIfApplicable, isEmail };
export type { Element, Item };
