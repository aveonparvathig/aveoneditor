import { Operation } from './operation';
import { Range } from '../range';
import type { MarkerCollection } from '../markercollection';
import type { Document } from '../document';

/** Adds, changes or removes a marker. */
export class MarkerOperation extends Operation {
  public readonly name: string;
  public readonly oldRange: Range | null;
  public readonly newRange: Range | null;
  public readonly affectsData: boolean;
  private readonly _markers: MarkerCollection;

  constructor(name: string, oldRange: Range | null, newRange: Range | null, markers: MarkerCollection, affectsData: boolean, baseVersion: number | null) {
    super(baseVersion);
    this.name = name;
    this.oldRange = oldRange ? oldRange.clone() : null;
    this.newRange = newRange ? newRange.clone() : null;
    this.affectsData = affectsData;
    this._markers = markers;
  }

  public get type(): string {
    return 'marker';
  }

  public override clone(): MarkerOperation {
    return new MarkerOperation(this.name, this.oldRange, this.newRange, this._markers, this.affectsData, this.baseVersion);
  }

  public override getReversed(): MarkerOperation {
    return new MarkerOperation(this.name, this.newRange, this.oldRange, this._markers, this.affectsData, this.baseVersion! + 1);
  }

  public override _execute(): void {
    if (this.newRange) {
      this._markers._set(this.name, this.newRange, true, this.affectsData);
    } else {
      this._markers._remove(this.name);
    }
  }

  public override toJSON(): Record<string, unknown> {
    const json = super.toJSON();
    json.name = this.name;
    json.oldRange = this.oldRange ? this.oldRange.toJSON() : null;
    json.newRange = this.newRange ? this.newRange.toJSON() : null;
    json.affectsData = this.affectsData;
    return json;
  }

  public static get className(): string {
    return 'MarkerOperation';
  }

  public static override fromJSON(json: any, document: Document): MarkerOperation {
    return new MarkerOperation(
      json.name,
      json.oldRange ? Range.fromJSON(json.oldRange, document) : null,
      json.newRange ? Range.fromJSON(json.newRange, document) : null,
      document.model.markers,
      json.affectsData,
      json.baseVersion
    );
  }
}
