import { Emitter } from '../../utils/emitter';
import { LiveRange } from './liverange';
import type { Range } from './range';
import type { Position } from './position';

/** Named, live range in the document (highlights, comments, find results). */
export class Marker extends Emitter {
  public readonly name: string;
  private _liveRange: LiveRange | null;
  private _managedUsingOperations: boolean;
  private _affectsData: boolean;

  constructor(name: string, liveRange: LiveRange, managedUsingOperations: boolean, affectsData: boolean) {
    super();
    this.name = name;
    this._liveRange = this._attachLiveRange(liveRange);
    this._managedUsingOperations = managedUsingOperations;
    this._affectsData = affectsData;
  }

  public get managedUsingOperations(): boolean {
    if (!this._liveRange) throw new Error('marker-destroyed');
    return this._managedUsingOperations;
  }

  public get affectsData(): boolean {
    if (!this._liveRange) throw new Error('marker-destroyed');
    return this._affectsData;
  }

  public getData(): { range: Range; affectsData: boolean; managedUsingOperations: boolean } {
    return { range: this.getRange(), affectsData: this.affectsData, managedUsingOperations: this.managedUsingOperations };
  }

  public getStart(): Position {
    if (!this._liveRange) throw new Error('marker-destroyed');
    return this._liveRange.start.clone();
  }

  public getEnd(): Position {
    if (!this._liveRange) throw new Error('marker-destroyed');
    return this._liveRange.end.clone();
  }

  public getRange(): Range {
    if (!this._liveRange) throw new Error('marker-destroyed');
    return this._liveRange.toRange();
  }

  public is(type: string): boolean {
    return type === 'marker' || type === 'model:marker';
  }

  /** @internal */
  public _attachLiveRange(liveRange: LiveRange): LiveRange {
    if (this._liveRange) this._detachLiveRange();
    liveRange.on('change:range', (evt, oldRange, data) => this.fire('change:range', oldRange, data));
    liveRange.on('change:content', (evt, oldRange, data) => this.fire('change:content', oldRange, data));
    this._liveRange = liveRange;
    return liveRange;
  }

  /** @internal */
  public _detachLiveRange(): void {
    this._liveRange!.off('change:range');
    this._liveRange!.off('change:content');
    this._liveRange!.detach();
    this._liveRange = null;
  }
}

/** Collection of markers in the model. */
export class MarkerCollection extends Emitter implements Iterable<Marker> {
  private _markers = new Map<string, Marker>();

  public [Symbol.iterator](): Iterator<Marker> {
    return this._markers.values();
  }

  public has(markerOrName: string | Marker): boolean {
    const name = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    return this._markers.has(name);
  }

  public get(markerName: string): Marker | null {
    return this._markers.get(markerName) || null;
  }

  /** @internal */
  public _set(markerOrName: string | Marker, range: Range, managedUsingOperations = false, affectsData = false): Marker {
    const markerName = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    if (markerName.includes(',')) throw new Error('markercollection-incorrect-marker-name');
    const oldMarker = this._markers.get(markerName);

    if (oldMarker) {
      const oldMarkerData = oldMarker.getData();
      const oldRange = oldMarker.getRange();
      let hasChanged = false;
      if (!oldRange.isEqual(range)) {
        oldMarker._attachLiveRange(LiveRange.fromRange(range));
        hasChanged = true;
      }
      if (managedUsingOperations !== oldMarkerData.managedUsingOperations) {
        (oldMarker as any)._managedUsingOperations = managedUsingOperations;
        hasChanged = true;
      }
      if (typeof affectsData === 'boolean' && affectsData !== oldMarkerData.affectsData) {
        (oldMarker as any)._affectsData = affectsData;
        hasChanged = true;
      }
      if (hasChanged) {
        this.fire('update:' + markerName, oldMarker, oldRange, range, oldMarkerData);
      }
      return oldMarker;
    }

    const liveRange = LiveRange.fromRange(range);
    const marker = new Marker(markerName, liveRange, managedUsingOperations, affectsData);
    this._markers.set(markerName, marker);
    this.fire('update:' + markerName, marker, null, range, { ...marker.getData(), range: null });
    return marker;
  }

  /** @internal */
  public _remove(markerOrName: string | Marker): boolean {
    const markerName = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    const oldMarker = this._markers.get(markerName);
    if (oldMarker) {
      this._markers.delete(markerName);
      this.fire('update:' + markerName, oldMarker, oldMarker.getRange(), null, oldMarker.getData());
      this._destroyMarker(oldMarker);
      return true;
    }
    return false;
  }

  /** @internal */
  public _refresh(markerOrName: string | Marker): void {
    const markerName = typeof markerOrName === 'string' ? markerOrName : markerOrName.name;
    const marker = this._markers.get(markerName);
    if (!marker) throw new Error('markercollection-refresh-marker-not-exists');
    const range = marker.getRange();
    this.fire('update:' + markerName, marker, range, range, marker.getData());
  }

  public *getMarkersAtPosition(position: Position): IterableIterator<Marker> {
    for (const marker of this) {
      if (marker.getRange().containsPosition(position)) yield marker;
    }
  }

  public *getMarkersIntersectingRange(range: Range): IterableIterator<Marker> {
    for (const marker of this) {
      if (marker.getRange().getIntersection(range) !== null) yield marker;
    }
  }

  public *getMarkersGroup(prefix: string): IterableIterator<Marker> {
    for (const marker of this._markers.values()) {
      if (marker.name.startsWith(prefix + ':')) yield marker;
    }
  }

  public destroy(): void {
    for (const marker of this._markers.values()) this._destroyMarker(marker);
    this._markers = new Map();
    this.stopListening();
  }

  private _destroyMarker(marker: Marker): void {
    marker.stopListening();
    marker._detachLiveRange();
  }
}
