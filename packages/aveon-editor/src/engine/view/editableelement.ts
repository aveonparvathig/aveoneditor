import { ContainerElement } from './containerelement';
import type { ElementAttributes } from './element';
import type { Document } from './document';
import type { Node } from './node';
import { Observable } from '../../utils/observable';

/** Editable region (root or nested editable inside a widget). Observable: `isReadOnly`, `isFocused`, `placeholder`. */
export class EditableElement extends ContainerElement {
  declare public isReadOnly: boolean;
  declare public isFocused: boolean;
  declare public placeholder: string | undefined;
  private readonly _observable = new Observable();

  constructor(document: Document, name: string, attrs?: ElementAttributes, children?: Node | Iterable<Node>) {
    super(document, name, attrs, children);
    installObservable(this, 'isReadOnly', false);
    installObservable(this, 'isFocused', false);
    installObservable(this, 'placeholder', undefined);
    this.bindTo(document);
  }

  public override is(type: string, name?: string): boolean {
    if (!name) {
      return type === 'editableElement' || type === 'view:editableElement' || super.is(type);
    }
    return name === this.name && (type === 'editableElement' || type === 'view:editableElement' || type === 'containerElement' || type === 'view:containerElement' || type === 'element' || type === 'view:element');
  }

  public bindTo(document: Document): void {
    this.listenTo(document, 'change:isReadOnly', (evt, name, value) => {
      this.isReadOnly = value;
    });
    this.listenTo(document, 'change:isFocused', () => {
      this.isFocused = document.isFocused && document.selection.editableElement === this;
    });
    this.listenTo(document.selection, 'change', () => {
      this.isFocused = document.isFocused && document.selection.editableElement === this;
    });
    this.isReadOnly = document.isReadOnly;
  }

  public destroy(): void {
    this.stopListening();
  }

  /** Sets an observable property (used by decorators). */
  public set(name: string, value: unknown): void {
    installObservable(this, name, value);
  }
}

function installObservable(element: EditableElement, name: string, initial: unknown): void {
  const desc = Object.getOwnPropertyDescriptor(element, name);
  if (desc && desc.get) {
    (element as any)[name] = initial;
    return;
  }
  let current = initial;
  Object.defineProperty(element, name, {
    enumerable: true,
    configurable: true,
    get: () => current,
    set: (value: unknown) => {
      const old = current;
      if (old !== value) {
        current = value;
        element.fire('change:' + name, name, value, old);
      }
    }
  });
  element.fire('change:' + name, name, initial, undefined);
}
