/** Hierarchical configuration store (`editor.config.get('toolbar.items')`). */
export class Config<T extends Record<string, any> = Record<string, any>> {
  private _config: Record<string, any> = {};

  constructor(configurations?: Partial<T>, defaultConfigurations?: Partial<T>) {
    if (defaultConfigurations) this.define(defaultConfigurations as any);
    if (configurations) this._setObjectToTarget(this._config, configurations, false);
  }

  public set(name: string | Record<string, any>, value?: any): void {
    this._setToTarget(this._config, name, value, false);
  }

  public define(name: string | Record<string, any>, value?: any): void {
    this._setToTarget(this._config, name, value, true);
  }

  public get<K = any>(name: string): K | undefined {
    return this._getFromSource(this._config, name);
  }

  public *names(): Iterable<string> {
    for (const name of Object.keys(this._config)) yield name;
  }

  private _setToTarget(target: Record<string, any>, name: string | Record<string, any>, value: any, isDefine: boolean): void {
    if (typeof name === 'object' && name !== null) {
      this._setObjectToTarget(target, name, isDefine);
      return;
    }
    const parts = name.split('.');
    name = parts.pop()!;
    for (const part of parts) {
      if (typeof target[part] !== 'object' || target[part] === null || Array.isArray(target[part])) {
        target[part] = {};
      }
      target = target[part];
    }
    if (isPlainObject(value)) {
      if (!isPlainObject(target[name])) target[name] = {};
      this._setObjectToTarget(target[name], value, isDefine);
      return;
    }
    if (isDefine && target[name] !== undefined) return;
    target[name] = value;
  }

  private _setObjectToTarget(target: Record<string, any>, configuration: Record<string, any>, isDefine: boolean): void {
    for (const key of Object.keys(configuration)) {
      this._setToTarget(target, key, configuration[key], isDefine);
    }
  }

  private _getFromSource(source: Record<string, any>, name: string): any {
    const parts = name.split('.');
    name = parts.pop()!;
    for (const part of parts) {
      if (typeof source[part] !== 'object' || source[part] === null) return undefined;
      source = source[part];
    }
    const value = source[name];
    return isPlainObject(value) ? cloneDeep(value) : value;
  }
}

export function isPlainObject(value: unknown): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => cloneDeep(v)) as any;
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) out[key] = cloneDeep(value[key]);
    return out as T;
  }
  return value;
}
