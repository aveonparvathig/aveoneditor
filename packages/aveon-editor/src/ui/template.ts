import { Emitter } from '../utils/emitter';
import type { Observable } from '../utils/observable';
import { isIterable } from '../utils/misc';
import type { View } from './view';
import type { ViewCollection } from './viewcollection';

type AttributeValue = string | number | boolean | TemplateBinding | Array<string | TemplateBinding> | undefined | null;

export interface TemplateDefinition {
  tag?: string;
  text?: string | TemplateBinding | Array<string | TemplateBinding>;
  attributes?: Record<string, AttributeValue | Record<string, AttributeValue>>;
  children?: Array<View | TemplateDefinition | Template | string | TemplateBinding> | ViewCollection;
  on?: Record<string, TemplateBinding | ((evt: Event) => void) | Array<TemplateBinding | ((evt: Event) => void)>>;
}

type BindingCallback = (value: any, node: Node) => unknown;

export class TemplateBinding {
  public readonly observable: Observable;
  public readonly emitter: Emitter;
  public readonly attribute: string;
  public readonly callback?: BindingCallback;
  public readonly type: 'to' | 'if' | 'event';
  public readonly valueIfTrue?: unknown;
  public readonly eventNameOrFunction?: string | ((evt: Event) => void);

  constructor(def: { observable: Observable; emitter: Emitter; attribute: string; callback?: BindingCallback; type: 'to' | 'if' | 'event'; valueIfTrue?: unknown; eventNameOrFunction?: string | ((evt: Event) => void) }) {
    this.observable = def.observable;
    this.emitter = def.emitter;
    this.attribute = def.attribute;
    this.callback = def.callback;
    this.type = def.type;
    this.valueIfTrue = def.valueIfTrue;
    this.eventNameOrFunction = def.eventNameOrFunction;
  }

  public getValue(node: Node): unknown {
    const value = (this.observable as any)[this.attribute];
    if (this.type === 'if') {
      const result = this.callback ? this.callback(value, node) : !!value;
      if (result) return this.valueIfTrue === undefined ? true : this.valueIfTrue;
      return false;
    }
    return this.callback ? this.callback(value, node) : value;
  }

  public activate(node: Node, updater: () => void): void {
    this.emitter.listenTo(this.observable, 'change:' + this.attribute, updater);
    updater();
  }
}

/**
 * Declarative DOM template with observable bindings. Used by every UI view.
 */
export class Template extends Emitter {
  public tag?: string;
  public text?: Array<string | TemplateBinding>;
  public attributes?: Record<string, Array<string | TemplateBinding> | Record<string, Array<string | TemplateBinding>>>;
  public children?: Array<Template | View | ViewCollection>;
  public eventListeners?: Record<string, Array<TemplateBinding | ((evt: Event) => void)>>;
  private _isRendered = false;
  private _revertData: { attributes: Record<string, string | null>; text?: string; children: Node[] } | null = null;

  constructor(def: TemplateDefinition) {
    super();
    Object.assign(this, normalize(def));
  }

  public render(): HTMLElement | Text {
    const node = this._renderNode({ node: null, isApplying: false, intoFragment: false });
    this._isRendered = true;
    return node;
  }

  public apply(node: HTMLElement | Text): HTMLElement | Text {
    this._revertData = { attributes: {}, children: [] };
    this._renderNode({ node, isApplying: true, intoFragment: false });
    return node;
  }

  public revert(node: HTMLElement | Text): void {
    if (!this._revertData) throw new Error('ui-template-revert-not-applied');
    const data = this._revertData;
    if (node instanceof HTMLElement) {
      for (const [name, value] of Object.entries(data.attributes)) {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
    }
    this.stopListening();
    this._revertData = null;
  }

  public *getViews(): IterableIterator<View> {
    if (!this.children) return;
    for (const child of this.children) {
      if (isView(child)) {
        yield child;
      } else if (child instanceof Template) {
        yield* child.getViews();
      }
    }
  }

  public static override bind(observable: Observable, emitter: Emitter): BindChain {
    return {
      to(eventNameOrFunctionOrAttribute: string | ((evt: Event) => void), callback?: BindingCallback) {
        return new TemplateBinding({
          observable,
          emitter,
          attribute: typeof eventNameOrFunctionOrAttribute === 'string' ? eventNameOrFunctionOrAttribute : '',
          callback,
          type: typeof eventNameOrFunctionOrAttribute === 'function' ? 'event' : 'to',
          eventNameOrFunction: eventNameOrFunctionOrAttribute
        });
      },
      if(attribute: string, valueIfTrue?: unknown, callback?: BindingCallback) {
        return new TemplateBinding({ observable, emitter, attribute, callback, type: 'if', valueIfTrue });
      }
    };
  }

  public static extend(template: Template, def: TemplateDefinition): void {
    if (template._isRendered) throw new Error('template-extend-render');
    const ext = normalize(def);
    if (ext.attributes) {
      if (!template.attributes) template.attributes = {};
      for (const [key, value] of Object.entries(ext.attributes)) {
        const existing = template.attributes[key];
        if (Array.isArray(existing) && Array.isArray(value)) {
          existing.push(...value);
        } else if (existing && !Array.isArray(existing) && !Array.isArray(value)) {
          Object.assign(existing, value);
        } else {
          template.attributes[key] = value;
        }
      }
    }
    if (ext.children) {
      if (!template.children) template.children = [];
      template.children.push(...ext.children);
    }
    if (ext.eventListeners) {
      if (!template.eventListeners) template.eventListeners = {};
      for (const [key, value] of Object.entries(ext.eventListeners)) {
        template.eventListeners[key] = [...(template.eventListeners[key] || []), ...value];
      }
    }
    if (ext.text) {
      template.text = ext.text;
    }
  }

  private _renderNode(data: { node: HTMLElement | Text | null; isApplying: boolean; intoFragment: boolean }): HTMLElement | Text {
    const isInvalid = this.tag && this.text ? true : !this.tag && !this.text;
    if (isInvalid) throw new Error('ui-template-wrong-syntax');
    if (this.text) return this._renderText(data);
    return this._renderElement(data);
  }

  private _renderElement(data: { node: HTMLElement | Text | null; isApplying: boolean; intoFragment: boolean }): HTMLElement {
    let node = data.node as HTMLElement | null;
    if (!node) {
      node = this.tag === 'svg' || this.tag === 'path' ? (document.createElementNS('http://www.w3.org/2000/svg', this.tag) as unknown as HTMLElement) : document.createElement(this.tag!);
    }
    this._renderAttributes(node, data.isApplying);
    this._renderElementChildren(node, data.isApplying);
    this._setUpListeners(node);
    return node;
  }

  private _renderText(data: { node: HTMLElement | Text | null; isApplying: boolean }): Text {
    let node = data.node as Text | null;
    if (!node) node = document.createTextNode('');
    const textNode = node;
    if (this.text!.some(item => item instanceof TemplateBinding)) {
      const updater = () => {
        const value = this.text!.map(item => (item instanceof TemplateBinding ? item.getValue(textNode) : item)).filter(v => v !== false && v !== undefined && v !== null).join('');
        if (textNode.textContent !== value) textNode.textContent = value;
      };
      for (const item of this.text!) {
        if (item instanceof TemplateBinding) item.activate(textNode, updater);
      }
      updater();
    } else {
      textNode.textContent = this.text!.join('');
    }
    return textNode;
  }

  private _renderAttributes(node: HTMLElement, isApplying: boolean): void {
    if (!this.attributes) return;
    for (const [attrName, attrValue] of Object.entries(this.attributes)) {
      if (attrName === 'style' && !Array.isArray(attrValue)) {
        this._renderStyleAttribute(node, attrValue as Record<string, Array<string | TemplateBinding>>);
        continue;
      }
      const values = attrValue as Array<string | TemplateBinding>;
      const hasBinding = values.some(v => v instanceof TemplateBinding);
      const isNs = attrName.includes(':') && !attrName.startsWith('xlink');
      const updater = () => {
        const parts = values.map(v => (v instanceof TemplateBinding ? v.getValue(node) : v));
        const filtered = parts.filter(v => v !== false && v !== undefined && v !== null && v !== '');
        if (attrName === 'class') {
          const classes = filtered.map(String).join(' ');
          if (classes) node.setAttribute('class', classes);
          else node.removeAttribute('class');
          return;
        }
        if (!filtered.length) {
          node.removeAttribute(attrName);
          return;
        }
        const value = filtered.length === 1 && typeof filtered[0] === 'boolean' ? (filtered[0] ? 'true' : 'false') : filtered.map(String).join(' ');
        if (isNs) {
          node.setAttributeNS(null, attrName, value);
        } else {
          node.setAttribute(attrName, value);
        }
      };
      if (isApplying && this._revertData) {
        this._revertData.attributes[attrName] = node.getAttribute(attrName);
      }
      if (hasBinding) {
        for (const v of values) {
          if (v instanceof TemplateBinding) v.activate(node, updater);
        }
      }
      updater();
    }
  }

  private _renderStyleAttribute(node: HTMLElement, styles: Record<string, Array<string | TemplateBinding>>): void {
    for (const [styleName, styleValue] of Object.entries(styles)) {
      const updater = () => {
        const parts = styleValue.map(v => (v instanceof TemplateBinding ? v.getValue(node) : v)).filter(v => v !== false && v !== undefined && v !== null);
        const value = parts.map(String).join('');
        (node.style as any)[toCamelCase(styleName)] = value;
      };
      for (const v of styleValue) {
        if (v instanceof TemplateBinding) v.activate(node, updater);
      }
      updater();
    }
  }

  private _renderElementChildren(node: HTMLElement, isApplying: boolean): void {
    if (!this.children) return;
    if (isViewCollection(this.children[0]) && this.children.length === 1) {
      (this.children[0] as ViewCollection).setParent(node);
      for (const child of this.children[0] as ViewCollection) {
        if (!child.isRendered) child.render();
        node.appendChild(child.element!);
      }
      return;
    }
    let childIndex = 0;
    for (const child of this.children) {
      if (isViewCollection(child)) {
        child.setParent(node);
        for (const view of child) {
          if (!view.isRendered) view.render();
          node.appendChild(view.element!);
        }
      } else if (isView(child)) {
        if (!child.isRendered) child.render();
        if (isApplying && node.childNodes[childIndex]) {
          node.replaceChild(child.element!, node.childNodes[childIndex]);
        } else {
          node.appendChild(child.element!);
        }
      } else if (child instanceof Template) {
        if (isApplying && node.childNodes[childIndex]) {
          child.apply(node.childNodes[childIndex] as HTMLElement | Text);
        } else {
          node.appendChild(child.render());
        }
      }
      childIndex++;
    }
  }

  private _setUpListeners(node: HTMLElement): void {
    if (!this.eventListeners) return;
    for (const [key, listeners] of Object.entries(this.eventListeners)) {
      const [domEvtName, selector] = key.split('@');
      for (const listener of listeners) {
        const handler = (domEvt: Event) => {
          if (selector) {
            const target = domEvt.target as Element;
            if (!target.matches(selector) && !target.closest(selector)) return;
          }
          if (typeof listener === 'function') {
            listener(domEvt);
          } else if (typeof listener.eventNameOrFunction === 'function') {
            listener.eventNameOrFunction(domEvt);
          } else {
            listener.observable.fire(listener.eventNameOrFunction!, domEvt);
          }
        };
        node.addEventListener(domEvtName, handler);
      }
    }
  }
}

export interface BindChain {
  to(eventNameOrFunctionOrAttribute: string | ((evt: Event) => void), callback?: BindingCallback): TemplateBinding;
  if(attribute: string, valueIfTrue?: unknown, callback?: BindingCallback): TemplateBinding;
}

function normalize(def: TemplateDefinition): Partial<Template> {
  const result: Partial<Template> = {};
  if (def.tag) result.tag = def.tag;
  if (def.text !== undefined) {
    result.text = Array.isArray(def.text) ? def.text : [def.text];
  }
  if (def.attributes) {
    const attrs: Record<string, any> = {};
    for (const [key, value] of Object.entries(def.attributes)) {
      if (key === 'style' && value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TemplateBinding)) {
        const styles: Record<string, Array<string | TemplateBinding>> = {};
        for (const [styleName, styleValue] of Object.entries(value as Record<string, AttributeValue>)) {
          styles[styleName] = Array.isArray(styleValue) ? styleValue : [styleValue as any];
        }
        attrs.style = styles;
      } else if (Array.isArray(value)) {
        attrs[key] = value.flat() as Array<string | TemplateBinding>;
      } else if (value === undefined || value === null) {
        continue;
      } else {
        attrs[key] = [value as any];
      }
    }
    result.attributes = attrs;
  }
  if (def.children) {
    if (isViewCollection(def.children as any)) {
      result.children = [def.children as ViewCollection];
    } else {
      result.children = (def.children as any[]).map(child => {
        if (isView(child) || child instanceof Template || isViewCollection(child)) return child;
        if (typeof child === 'string' || child instanceof TemplateBinding) return new Template({ text: child });
        return new Template(child as TemplateDefinition);
      });
    }
  }
  if (def.on) {
    const listeners: Record<string, Array<TemplateBinding | ((evt: Event) => void)>> = {};
    for (const [key, value] of Object.entries(def.on)) {
      listeners[key] = Array.isArray(value) ? value : [value];
    }
    result.eventListeners = listeners;
  }
  return result;
}

function isView(item: unknown): item is View {
  return !!item && typeof (item as any).render === 'function' && typeof (item as any).setTemplate === 'function';
}

function isViewCollection(item: unknown): item is ViewCollection {
  return !!item && typeof (item as any).setParent === 'function' && isIterable(item);
}

function toCamelCase(name: string): string {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
