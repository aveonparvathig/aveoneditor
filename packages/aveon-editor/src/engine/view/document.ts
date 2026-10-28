import { Observable } from '../../utils/observable';
import { Collection } from '../../utils/collection';
import { EventInfo } from '../../utils/eventinfo';
import { priorities, type PriorityString } from '../../utils/priorities';
import { DocumentSelection } from './documentselection';
import type { RootEditableElement } from './rooteditableelement';
import type { DowncastWriter } from './downcastwriter';
import type { Element } from './element';
import type { Node } from './node';

export type ViewPostFixer = (writer: DowncastWriter) => boolean | void;
export type BubblingContext = string | ((node: Node | Element) => boolean) | '$capture' | '$document' | '$root' | '$text';

interface ContextListener {
  context: BubblingContext;
  callback: (evt: EventInfo, ...args: any[]) => void;
  priority: number;
}

/**
 * The view document: roots, selection, focus/read-only state and post-fixers.
 * Events fired on it bubble through contexts (`$capture`, element names, `$text`, `$root`, `$document`).
 */
export class Document extends Observable {
  public readonly selection = new DocumentSelection();
  public readonly roots = new Collection<RootEditableElement>({ idProperty: 'rootName' });
  declare public isReadOnly: boolean;
  declare public isFocused: boolean;
  declare public isSelecting: boolean;
  declare public isComposing: boolean;
  private _postFixers = new Set<ViewPostFixer>();
  private _contextListeners = new Map<string, ContextListener[]>();

  constructor() {
    super();
    this.set('isReadOnly', false);
    this.set('isFocused', false);
    this.set('isSelecting', false);
    this.set('isComposing', false);
  }

  public getRoot(name = 'main'): RootEditableElement | null {
    return this.roots.get(name);
  }

  public registerPostFixer(postFixer: ViewPostFixer): void {
    this._postFixers.add(postFixer);
  }

  public destroy(): void {
    this.roots.forEach(root => root.destroy());
    this.stopListening();
  }

  /** @internal */
  public _callPostFixers(writer: DowncastWriter): void {
    let wasFixed = false;
    let guard = 0;
    do {
      wasFixed = false;
      for (const callback of this._postFixers) {
        wasFixed = !!callback(writer);
        if (wasFixed) break;
      }
    } while (wasFixed && guard++ < 100);
  }

  /** Adds a listener with an optional bubbling `context`. */
  public override on(event: string, callback: (evt: EventInfo, ...args: any[]) => void, options: { priority?: PriorityString | number; context?: BubblingContext | BubblingContext[] } = {}): void {
    if (!options.context) {
      super.on(event, callback, options);
      return;
    }
    const contexts = Array.isArray(options.context) ? options.context : [options.context];
    for (const context of contexts) {
      if (!this._contextListeners.has(event)) this._contextListeners.set(event, []);
      const listeners = this._contextListeners.get(event)!;
      const listener = { context, callback, priority: priorities.get(options.priority) };
      let index = listeners.length;
      for (let i = 0; i < listeners.length; i++) {
        if (listeners[i].priority < listener.priority) {
          index = i;
          break;
        }
      }
      listeners.splice(index, 0, listener);
    }
  }

  public override off(event: string, callback?: (evt: EventInfo, ...args: any[]) => void): void {
    super.off(event, callback);
    const listeners = this._contextListeners.get(event);
    if (listeners) {
      this._contextListeners.set(event, callback ? listeners.filter(l => l.callback !== callback) : []);
    }
  }

  /**
   * Fires the event through bubbling contexts first (capture, deepest element up to root),
   * then through regular listeners (`$document`).
   */
  public override fire<T = unknown>(eventOrInfo: string | EventInfo, ...args: any[]): T | undefined {
    const evt = typeof eventOrInfo === 'string' ? new EventInfo(this, eventOrInfo) : eventOrInfo;
    const listeners = this._contextListeners.get(evt.name);
    if (listeners && listeners.length) {
      const selection = this.selection;
      const startPosition = selection.getFirstPosition();
      const ordered: ContextListener[] = [];

      // $capture
      ordered.push(...listeners.filter(l => l.context === '$capture'));

      if (startPosition) {
        const selectedElement = selection.getSelectedElement();
        const ancestors: Array<Node | Element> = [];
        if (selectedElement) {
          ancestors.push(selectedElement);
        }
        let parent: any = startPosition.parent;
        if (startPosition.parent && (startPosition.parent as any).is('$text')) {
          // $text listeners
          ordered.push(...listeners.filter(l => l.context === '$text'));
          parent = parent.parent;
        } else if (selection.isCollapsed) {
          ordered.push(...listeners.filter(l => l.context === '$text'));
        }
        while (parent && (parent as any).is && (parent as any).is('element')) {
          ancestors.push(parent);
          parent = parent.parent;
        }
        for (const node of ancestors) {
          for (const listener of listeners) {
            if (typeof listener.context === 'function') {
              if (listener.context(node)) ordered.push(listener);
            } else if (typeof listener.context === 'string' && !listener.context.startsWith('$')) {
              if ((node as Element).name === listener.context) ordered.push(listener);
            }
          }
          if ((node as any).is('rootElement')) {
            ordered.push(...listeners.filter(l => l.context === '$root'));
          }
        }
      }
      ordered.push(...listeners.filter(l => l.context === '$document'));

      evt.path.push(this);
      for (const listener of ordered) {
        listener.callback.call(this, evt, ...args);
        if (evt.stopped) return evt.return as T;
      }
    }
    return super.fire(evt, ...args);
  }
}
