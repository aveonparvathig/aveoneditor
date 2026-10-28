import { EventInfo } from './eventinfo';
import { priorities, type PriorityString } from './priorities';

export type Callback = (evt: EventInfo, ...args: any[]) => any;

export interface CallbackOptions {
  priority?: PriorityString | number;
  /** Bubbling context (supported by the view document). */
  context?: unknown;
}

interface Listener {
  callback: Callback;
  priority: number;
}

interface ListenerBinding {
  emitter: Emitter;
  event: string;
  callback: Callback;
}

/**
 * Event emitter used across the editor. Listeners may be prioritised, stop
 * event propagation and return values via `evt.return`. Namespaced events
 * (`change:value`) also fire their parents (`change`).
 */
export class Emitter {
  private _events?: Map<string, Listener[]>;
  private _listening?: ListenerBinding[];
  private _delegations?: Map<string, Map<Emitter, string | ((name: string) => string) | null>>;

  public on(event: string, callback: Callback, options: CallbackOptions = {}): void {
    this.listenTo(this, event, callback, options);
  }

  public once(event: string, callback: Callback, options: CallbackOptions = {}): void {
    let wasFired = false;
    const onceCallback: Callback = (evt, ...args) => {
      if (wasFired) return;
      wasFired = true;
      evt.off();
      callback.call(this, evt, ...args);
    };
    this.listenTo(this, event, onceCallback, options);
  }

  public off(event: string, callback?: Callback): void {
    this.stopListening(this, event, callback);
  }

  public listenTo(emitter: Emitter, event: string, callback: Callback, options: CallbackOptions = {}): void {
    if (!this._listening) this._listening = [];
    this._listening.push({ emitter, event, callback });
    if (options.context !== undefined) {
      // Emitters supporting bubbling contexts register these through their own `on()`.
      emitter.on(event, callback, options);
      return;
    }
    emitter._addListener(event, callback, priorities.get(options.priority));
  }

  public stopListening(emitter?: Emitter, event?: string, callback?: Callback): void {
    if (!this._listening) return;
    const remaining: ListenerBinding[] = [];
    const matched: ListenerBinding[] = [];
    for (const binding of this._listening) {
      const match =
        (!emitter || binding.emitter === emitter) &&
        (!event || binding.event === event) &&
        (!callback || binding.callback === callback);
      (match ? matched : remaining).push(binding);
    }
    // Update the bookkeeping first: emitters with a custom off() may call back into stopListening().
    this._listening = remaining;
    for (const binding of matched) {
      binding.emitter._removeListener(binding.event, binding.callback);
      if (binding.emitter.off !== Emitter.prototype.off) {
        binding.emitter.off(binding.event, binding.callback);
      }
    }
  }

  public fire<T = unknown>(eventOrInfo: string | EventInfo, ...args: any[]): T | undefined {
    const evt = typeof eventOrInfo === 'string' ? new EventInfo(this, eventOrInfo) : eventOrInfo;
    const eventName = evt.name;
    evt.path.push(this);

    const names = getNamespaces(eventName);
    for (const name of names) {
      const listeners = this._events?.get(name);
      if (!listeners || listeners.length === 0) continue;
      for (const listener of [...listeners]) {
        listener.callback.call(this, evt, ...args);
        if (evt.offed) {
          this._removeListener(name, listener.callback);
          evt._resetOff();
        }
        if (evt.stopped) {
          return evt.return as T;
        }
      }
    }

    if (this._delegations) {
      const targets = this._delegations.get(eventName) || this._delegations.get('*');
      if (targets) {
        for (const [target, nameOrFn] of targets) {
          const delegatedName = typeof nameOrFn === 'function' ? nameOrFn(eventName) : nameOrFn || eventName;
          const delegatedInfo = new EventInfo(evt.source, delegatedName);
          delegatedInfo.path.push(...evt.path);
          target.fire(delegatedInfo, ...args);
        }
      }
    }

    return evt.return as T;
  }

  public delegate(...events: string[]): { to(emitter: Emitter, nameOrFn?: string | ((name: string) => string)): void } {
    return {
      to: (emitter, nameOrFn) => {
        if (!this._delegations) this._delegations = new Map();
        for (const event of events) {
          if (!this._delegations.has(event)) this._delegations.set(event, new Map());
          this._delegations.get(event)!.set(emitter, nameOrFn ?? null);
        }
      }
    };
  }

  public stopDelegating(event?: string, emitter?: Emitter): void {
    if (!this._delegations) return;
    if (!event) {
      this._delegations.clear();
    } else if (!emitter) {
      this._delegations.delete(event);
    } else {
      this._delegations.get(event)?.delete(emitter);
    }
  }

  private _addListener(event: string, callback: Callback, priority: number): void {
    if (!this._events) this._events = new Map();
    let listeners = this._events.get(event);
    if (!listeners) {
      listeners = [];
      this._events.set(event, listeners);
    }
    const listener = { callback, priority };
    let index = listeners.length;
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i].priority < priority) {
        index = i;
        break;
      }
    }
    listeners.splice(index, 0, listener);
  }

  private _removeListener(event: string, callback: Callback): void {
    const listeners = this._events?.get(event);
    if (!listeners) return;
    const index = listeners.findIndex(l => l.callback === callback);
    if (index > -1) listeners.splice(index, 1);
  }
}

function getNamespaces(name: string): string[] {
  const parts = name.split(':');
  const result: string[] = [];
  for (let i = parts.length; i > 0; i--) {
    result.push(parts.slice(0, i).join(':'));
  }
  return result;
}
