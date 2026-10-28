/** Base class for conversion helper groups; registers converters on all dispatchers of the group. */
export class ConversionHelpers<TDispatcher> {
  private _dispatchers: TDispatcher[];

  constructor(dispatchers: TDispatcher[]) {
    this._dispatchers = dispatchers;
  }

  public add(conversionHelper: (dispatcher: TDispatcher) => void): this {
    for (const dispatcher of this._dispatchers) {
      conversionHelper(dispatcher);
    }
    return this;
  }
}
