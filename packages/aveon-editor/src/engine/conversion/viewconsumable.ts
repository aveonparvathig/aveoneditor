import { Element as ViewElement } from '../view/element';
import { Text as ViewText } from '../view/text';
import { DocumentFragment as ViewDocumentFragment } from '../view/documentfragment';
import type { Node as ViewNode } from '../view/node';
import type { MatchResult } from '../view/matcher';

export interface Consumables {
  name?: boolean;
  attributes?: string | string[];
  classes?: string | string[];
  styles?: string | string[];
}

/** Tracks which parts of view items (name, attributes, classes, styles) were consumed during upcast. */
export class ViewConsumable {
  private _consumables = new Map<ViewNode | ViewDocumentFragment, ViewElementConsumables | boolean>();

  public add(element: ViewNode | ViewDocumentFragment, consumables?: Consumables | MatchResult): void {
    let elementConsumables: ViewElementConsumables;
    if (element instanceof ViewText || element instanceof ViewDocumentFragment) {
      this._consumables.set(element, true);
      return;
    }
    if (!this._consumables.has(element)) {
      elementConsumables = new ViewElementConsumables(element as ViewElement);
      this._consumables.set(element, elementConsumables);
    } else {
      elementConsumables = this._consumables.get(element) as ViewElementConsumables;
    }
    elementConsumables.add(consumables || {});
  }

  public test(element: ViewNode | ViewDocumentFragment, consumables?: Consumables | MatchResult): boolean | null {
    const elementConsumables = this._consumables.get(element);
    if (elementConsumables === undefined) return null;
    if (element instanceof ViewText || element instanceof ViewDocumentFragment) {
      return elementConsumables as boolean;
    }
    return (elementConsumables as ViewElementConsumables).test(consumables || {});
  }

  public consume(element: ViewNode | ViewDocumentFragment, consumables?: Consumables | MatchResult): boolean {
    if (this.test(element, consumables)) {
      if (element instanceof ViewText || element instanceof ViewDocumentFragment) {
        this._consumables.set(element, false);
      } else {
        (this._consumables.get(element) as ViewElementConsumables).consume(consumables || {});
      }
      return true;
    }
    return false;
  }

  public revert(element: ViewNode | ViewDocumentFragment, consumables?: Consumables | MatchResult): void {
    const elementConsumables = this._consumables.get(element);
    if (elementConsumables !== undefined) {
      if (element instanceof ViewText || element instanceof ViewDocumentFragment) {
        this._consumables.set(element, true);
      } else {
        (elementConsumables as ViewElementConsumables).revert(consumables || {});
      }
    }
  }

  public static consumablesFromElement(element: ViewElement): Consumables & { element: ViewElement } {
    const consumables = { element, name: true, attributes: [] as string[], classes: [] as string[], styles: [] as string[] };
    const attributes = Array.from(element.getAttributeKeys());
    for (const attribute of attributes) {
      if (attribute === 'style' || attribute === 'class') continue;
      consumables.attributes.push(attribute);
    }
    const classes = element.getClassNames();
    for (const className of classes) consumables.classes.push(className);
    const styles = element.getStyleNames();
    for (const style of styles) consumables.styles.push(style);
    return consumables;
  }

  public static createFrom(from: ViewNode | ViewDocumentFragment, instance?: ViewConsumable): ViewConsumable {
    if (!instance) instance = new ViewConsumable();
    if (from instanceof ViewText) {
      instance.add(from);
      return instance;
    }
    if (from instanceof ViewElement) {
      instance.add(from, ViewConsumable.consumablesFromElement(from));
    }
    if (from instanceof ViewDocumentFragment) {
      instance.add(from);
    }
    for (const child of (from as ViewElement | ViewDocumentFragment).getChildren()) {
      instance = ViewConsumable.createFrom(child, instance);
    }
    return instance;
  }
}

class ViewElementConsumables {
  public readonly element: ViewElement;
  private _canConsumeName: boolean | null = null;
  private _consumables = { attributes: new Map<string, boolean>(), styles: new Map<string, boolean>(), classes: new Map<string, boolean>() };

  constructor(from: ViewElement) {
    this.element = from;
  }

  public add(consumables: Consumables | MatchResult): void {
    if (consumables.name) this._canConsumeName = true;
    for (const type of ['attributes', 'classes', 'styles'] as const) {
      if (consumables[type]) this._add(type, consumables[type]!);
    }
  }

  public test(consumables: Consumables | MatchResult): boolean | null {
    if (consumables.name && !this._canConsumeName) return this._canConsumeName;
    for (const type of ['attributes', 'classes', 'styles'] as const) {
      if (consumables[type]) {
        const value = this._test(type, consumables[type]!);
        if (value !== true) return value;
      }
    }
    return true;
  }

  public consume(consumables: Consumables | MatchResult): void {
    if (consumables.name) this._canConsumeName = false;
    for (const type of ['attributes', 'classes', 'styles'] as const) {
      if (consumables[type]) this._consume(type, consumables[type]!);
    }
  }

  public revert(consumables: Consumables | MatchResult): void {
    if (consumables.name) this._canConsumeName = true;
    for (const type of ['attributes', 'classes', 'styles'] as const) {
      if (consumables[type]) this._revert(type, consumables[type]!);
    }
  }

  private _add(type: 'attributes' | 'classes' | 'styles', item: string | string[]): void {
    const items = Array.isArray(item) ? item : [item];
    const consumables = this._consumables[type];
    for (const name of items) {
      if (type === 'attributes' && (name === 'class' || name === 'style')) {
        throw new Error('viewconsumable-invalid-attribute');
      }
      consumables.set(name, true);
    }
  }

  private _test(type: 'attributes' | 'classes' | 'styles', item: string | string[]): boolean | null {
    const items = Array.isArray(item) ? item : [item];
    const consumables = this._consumables[type];
    for (const name of items) {
      if (type === 'attributes' && (name === 'class' || name === 'style')) {
        const consumableName = name === 'class' ? 'classes' : 'styles';
        const value = this._test(consumableName, [...this._consumables[consumableName].keys()]);
        if (value !== true) return value;
      } else {
        const value = consumables.get(name);
        if (value === undefined) return null;
        if (!value) return false;
      }
    }
    return true;
  }

  private _consume(type: 'attributes' | 'classes' | 'styles', item: string | string[]): void {
    const items = Array.isArray(item) ? item : [item];
    const consumables = this._consumables[type];
    for (const name of items) {
      if (type === 'attributes' && (name === 'class' || name === 'style')) {
        const consumableName = name === 'class' ? 'classes' : 'styles';
        this._consume(consumableName, [...this._consumables[consumableName].keys()]);
      } else {
        consumables.set(name, false);
      }
    }
  }

  private _revert(type: 'attributes' | 'classes' | 'styles', item: string | string[]): void {
    const items = Array.isArray(item) ? item : [item];
    const consumables = this._consumables[type];
    for (const name of items) {
      if (type === 'attributes' && (name === 'class' || name === 'style')) {
        const consumableName = name === 'class' ? 'classes' : 'styles';
        this._revert(consumableName, [...this._consumables[consumableName].keys()]);
      } else {
        const value = consumables.get(name);
        if (value === false) consumables.set(name, true);
      }
    }
  }
}
