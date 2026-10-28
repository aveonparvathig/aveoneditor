/** Describes a fired event. Passed as the first argument to every listener. */
export class EventInfo<TName extends string = string, TReturn = unknown> {
  public readonly source: object;
  public readonly name: TName;
  public readonly path: object[] = [];
  public return: TReturn | undefined;
  private _stopped = false;
  private _off = false;

  constructor(source: object, name: TName) {
    this.source = source;
    this.name = name;
  }

  /** Stops the event from reaching remaining listeners. */
  public stop(): void {
    this._stopped = true;
  }

  /** Removes the current listener. */
  public off(): void {
    this._off = true;
  }

  public get stopped(): boolean {
    return this._stopped;
  }

  public get offed(): boolean {
    return this._off;
  }

  /** @internal */
  public _resetOff(): void {
    this._off = false;
  }
}
