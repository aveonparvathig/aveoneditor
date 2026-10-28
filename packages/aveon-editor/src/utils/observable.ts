import { Emitter } from './emitter';

interface Binding {
  property: string;
  to: Array<{ observable: Observable; property: string }>;
  callback?: (...values: any[]) => any;
}

/**
 * Observable adds observable properties (`set`), property binding (`bind().to()`)
 * and method decoration (`decorate`) on top of the event emitter.
 */
export class Observable extends Emitter {
  private _observableProps?: Map<string, unknown>;
  private _boundProps?: Map<string, Binding>;
  private _boundObservables?: Map<Observable, Map<string, Set<Binding>>>;

  /** Defines (or updates) observable properties; fires `set:<name>` and `change:<name>`. */
  public set(name: string | Record<string, unknown>, value?: unknown): void {
    if (typeof name === 'object') {
      for (const [key, val] of Object.entries(name)) this.set(key, val);
      return;
    }
    if (!this._observableProps) this._observableProps = new Map();
    const props = this._observableProps;

    if (!props.has(name)) {
      const descriptor = Object.getOwnPropertyDescriptor(this, name);
      if (!descriptor || !descriptor.get) {
        Object.defineProperty(this, name, {
          enumerable: true,
          configurable: true,
          get: () => props.get(name),
          set: (newValue: unknown) => {
            const oldValue = props.get(name);
            if (!props.has(name) || oldValue !== newValue) {
              const result = this.fire<unknown>('set:' + name, name, newValue, oldValue);
              const finalValue = result === undefined ? newValue : result;
              props.set(name, finalValue);
              this.fire('change:' + name, name, finalValue, oldValue);
            }
          }
        });
      }
    }
    (this as any)[name] = value;
  }

  /** Binds observable properties to properties of other observables. */
  public bind(...properties: string[]): BindChain {
    if (!this._boundProps) this._boundProps = new Map();
    if (!this._boundObservables) this._boundObservables = new Map();

    for (const property of properties) {
      if (this._boundProps.has(property)) {
        throw new Error(`observable-bind-rebind: Property "${property}" is already bound.`);
      }
    }
    const bindings: Binding[] = properties.map(property => {
      const binding: Binding = { property, to: [] };
      this._boundProps!.set(property, binding);
      return binding;
    });

    const chain: BindChain = {
      to: (...args: any[]) => {
        const parsed = parseBindToArgs(args);
        if (parsed.callback && bindings.length > 1) {
          throw new Error('observable-bind-to-extra-callback: Cannot bind multiple properties with a callback.');
        }
        bindings.forEach((binding, i) => {
          if (parsed.callback) {
            binding.to = parsed.to.map(t => ({ observable: t.observable, property: t.property ?? binding.property }));
            binding.callback = parsed.callback;
          } else {
            const target = parsed.to[i] ?? parsed.to[0];
            binding.to = [{ observable: target.observable, property: target.property ?? binding.property }];
          }
          for (const t of binding.to) {
            this._attachBinding(binding, t.observable, t.property);
          }
          this._updateBoundProperty(binding);
        });
      },
      toMany: (observables: Observable[], property: string, callback: (...values: any[]) => any) => {
        if (bindings.length > 1) throw new Error('observable-bind-to-many-not-one-binding');
        const binding = bindings[0];
        binding.to = observables.map(observable => ({ observable, property }));
        binding.callback = callback;
        for (const t of binding.to) this._attachBinding(binding, t.observable, t.property);
        this._updateBoundProperty(binding);
      }
    };
    return chain;
  }

  public unbind(...properties: string[]): void {
    if (!this._boundProps) return;
    const names = properties.length ? properties : [...this._boundProps.keys()];
    for (const name of names) {
      const binding = this._boundProps.get(name);
      if (!binding) continue;
      for (const t of binding.to) {
        const map = this._boundObservables!.get(t.observable);
        map?.get(t.property)?.delete(binding);
        if (map && map.get(t.property)?.size === 0) {
          map.delete(t.property);
        }
        if (map && map.size === 0) {
          this.stopListening(t.observable, 'change');
          this._boundObservables!.delete(t.observable);
        }
      }
      this._boundProps.delete(name);
    }
  }

  /** Makes a method fire an event of the same name; listeners can alter arguments or cancel. */
  public decorate(methodName: string): void {
    const original = (this as any)[methodName] as (...args: any[]) => any;
    if (typeof original !== 'function') {
      throw new Error(`observable-decorate-missing-method: Cannot decorate "${methodName}".`);
    }
    this.on(methodName, (evt, args: any[]) => {
      evt.return = original.apply(this, args);
    });
    (this as any)[methodName] = function (this: Observable, ...args: any[]) {
      return this.fire(methodName, args);
    };
    (this as any)[methodName]._originalMethod = original;
  }

  private _attachBinding(binding: Binding, observable: Observable, property: string): void {
    let map = this._boundObservables!.get(observable);
    if (!map) {
      map = new Map();
      this._boundObservables!.set(observable, map);
      this.listenTo(observable, 'change', (evt, propertyName: string) => {
        const bindings = this._boundObservables!.get(observable)?.get(propertyName);
        if (bindings) for (const b of bindings) this._updateBoundProperty(b);
      });
    }
    if (!map.has(property)) map.set(property, new Set());
    map.get(property)!.add(binding);
  }

  private _updateBoundProperty(binding: Binding): void {
    const values = binding.to.map(t => (t.observable as any)[t.property]);
    const value = binding.callback ? binding.callback(...values) : values[0];
    if (this._observableProps?.has(binding.property)) {
      (this as any)[binding.property] = value;
    } else {
      this.set(binding.property, value);
    }
  }
}

export interface BindChain {
  to(...args: any[]): void;
  toMany(observables: Observable[], property: string, callback: (...values: any[]) => any): void;
}

function parseBindToArgs(args: any[]): { to: Array<{ observable: Observable; property?: string }>; callback?: (...values: any[]) => any } {
  const to: Array<{ observable: Observable; property?: string }> = [];
  let callback: ((...values: any[]) => any) | undefined;
  for (const arg of args) {
    if (typeof arg === 'function') {
      callback = arg;
    } else if (typeof arg === 'string') {
      if (to.length === 0) throw new Error('observable-bind-to-parse-error');
      const last = to[to.length - 1];
      // `to(command, 'value', 'isEnabled')` names one property per bound property, in order.
      if (last.property === undefined) last.property = arg;
      else to.push({ observable: last.observable, property: arg });
    } else {
      to.push({ observable: arg });
    }
  }
  return { to, callback };
}
