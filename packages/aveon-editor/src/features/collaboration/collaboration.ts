/**
 * Real-time collaboration: several people edit the same document at once through the Aveon
 * collaboration server (`@aveon/collab-server`).
 *
 *   user: { id: 'u-17', name: 'Asha Rao' },
 *   collaboration: { url: 'wss://collab.example.com', documentId: 'quote-42', token: () => getToken() }
 *
 * How it stays consistent: the server keeps one ordered list of model operations. Local edits are
 * sent with the version they are based on. When someone else's edits arrive first, the local,
 * unconfirmed edits are rolled back, the remote edits applied, and the local edits replayed on top
 * (their positions mapped through the remote edits) before being sent again. Every copy therefore
 * applies the same operations in the same order.
 *
 * Also shared: each user's cursor and selection (shown with their name and colour), who is
 * connected, and comment threads. Track-changes suggestions travel inside the content. Edits made
 * while offline are kept and sent after reconnecting.
 */

import { Plugin } from '../../core/plugin';
import { View } from '../../ui/view';
import { transformOperation } from '../undo/transform';
import { Position } from '../../engine/model/position';
import { Range } from '../../engine/model/range';
import { _remove } from '../../engine/model/operation/utils';
import { InsertOperation } from '../../engine/model/operation/insertoperation';
import { MoveOperation } from '../../engine/model/operation/moveoperation';
import { SplitOperation } from '../../engine/model/operation/splitoperation';
import { RenameOperation } from '../../engine/model/operation/renameoperation';
import { AttributeOperation } from '../../engine/model/operation/attributeoperation';
import { Text } from '../../engine/model/text';
import { getEditorUser, type EditorUser, type CommentThread } from '../comments/comments';
import { escapeHtml } from '../shared/upcast';
import type { Editor } from '../../core/editor';
import type { Operation } from '../../engine/model/operation/operation';
import type { Locale } from '../../utils/locale';

export interface CollaborationConfig {
  /** WebSocket URL of the collaboration server. */
  url: string;
  /** The shared document (e.g. `invoice-1042`). */
  documentId: string;
  /** Passed to the server's `authenticate()`; a function is called on every (re)connect. */
  token?: string | (() => string | Promise<string>);
  /** WebSocket implementation (for Node or tests). Default: the browser's. */
  WebSocket?: typeof WebSocket;
  /** Delay before sending local edits, in ms. Default 30. */
  sendDelay?: number;
}

export type ConnectionState = 'connecting' | 'connected' | 'offline' | 'denied';

export interface RemoteUser {
  clientId: number;
  user: EditorUser;
  color: number;
  selection: SelectionData | null;
}

interface PositionData {
  root: string;
  path: number[];
}

interface SelectionData {
  anchor: PositionData;
  focus: PositionData;
}

const READ_ONLY_LOCK = 'real-time-collaboration';
const CARET = 'collab-caret';
const SELECTION = 'collab-selection';

export class RealTimeCollaboration extends Plugin {
  declare public connectionState: ConnectionState;
  /** Other people in the document. */
  declare public users: RemoteUser[];
  /** This client's colour index. */
  declare public color: number;
  private _socket: WebSocket | null = null;
  private _version = 0;
  private _joined = false;
  private _pending: Operation[] = [];
  private _inflight = 0;
  /** Set while remote edits are applied. */
  private _internal = false;
  /** Set while this plugin itself applies an operation (rollback, remote edit or replay). */
  private _applyingOwn = false;
  /** Set while the shared copy is loaded. */
  private _loading = false;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private _snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _retries = 0;
  private _destroyed = false;
  private _lastSnapshotVersion = -1;
  private _sentThreads = new Map<string, string>();
  private _freshJoin = false;
  private _noSnapshot = false;

  public static override get pluginName(): string {
    return 'RealTimeCollaboration';
  }

  public get config(): CollaborationConfig | undefined {
    const config = this.editor.config.get('collaboration') as CollaborationConfig | undefined;
    return config && config.url && config.documentId ? config : undefined;
  }

  /** The server version this client's document is confirmed at. */
  public get version(): number {
    return this._version;
  }

  /** Whether all local edits have reached the server. */
  public get isSynced(): boolean {
    return this._joined && !this._pending.length && this.connectionState === 'connected';
  }

  public override init(): void {
    const editor = this.editor;
    this.set('connectionState', 'connecting');
    this.set('users', []);
    this.set('color', 0);
    if (!this.config) return;

    this._setUpPresenceConversion();
    this._addUI();

    // Local edits.
    this.listenTo(editor.model, 'applyOperation', (evt: any, args: any[]) => {
      const operation = args[0] as Operation;
      if (!operation.isDocumentOperation || !this._joined || this._loading || this._applyingOwn) return;
      // While remote edits are applied, anything else that changes the document (post-fixers,
      // selection bookkeeping) is this client's own edit and is shared like typing.
      if (!this._internal) {
        const batch = operation.batch;
        if (batch && !batch.isLocal) return;
      }
      if (operation.type === 'marker' && !(operation as any).affectsData) return;
      this._pending.push(...this._toWire(operation));
      this._scheduleFlush();
    }, { priority: 'lowest' });

    this.listenTo(editor.model.document.selection, 'change:range', () => this._schedulePresence());

    if (editor.plugins.has('Comments')) {
      const comments = editor.plugins.get('Comments') as any;
      this.listenTo(comments, 'change', (evt: any, threads: unknown, info?: { remote?: boolean }) => {
        if (info && info.remote) this._rememberThreads(comments.getAllThreads());
        else this._sendThreads();
      });
    }

    // Read-only until the shared document has arrived.
    editor.enableReadOnlyMode(READ_ONLY_LOCK);
    editor.once('ready', () => this._connect());
  }

  public override destroy(): void {
    this._destroyed = true;
    for (const timer of [this._flushTimer, this._presenceTimer, this._snapshotTimer, this._reconnectTimer]) if (timer) clearTimeout(timer);
    if (this._socket) {
      this._socket.onclose = null;
      this._socket.close();
    }
    super.destroy();
  }

  /** Drops the connection (e.g. to test offline editing); edits are kept and sent on `reconnect()`. */
  public disconnect(): void {
    if (this._socket) this._socket.close();
  }

  public reconnect(): void {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (!this._socket || this._socket.readyState >= 2) void this._connect();
  }

  /* --------------------------------------------------------------------------------------- */
  /* Connection                                                                               */
  /* --------------------------------------------------------------------------------------- */

  private async _connect(): Promise<void> {
    const config = this.config;
    if (!config || this._destroyed) return;
    const SocketClass = config.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (!SocketClass) {
      console.warn('collaboration-no-websocket: No WebSocket implementation is available.');
      return;
    }
    this.connectionState = 'connecting';
    let token: string | undefined;
    try {
      token = typeof config.token === 'function' ? await config.token() : config.token;
    } catch (error) {
      console.warn('collaboration-token-failed', error);
    }
    if (this._destroyed) return;
    const socket = new SocketClass(withDocumentId(config.url, config.documentId));
    this._socket = socket;
    socket.onopen = () => {
      const fresh = !this._joined || this._freshJoin;
      this._send({
        type: 'join',
        documentId: config.documentId,
        token,
        user: getEditorUser(this.editor),
        version: fresh ? undefined : this._version,
        fresh,
        noSnapshot: this._noSnapshot || undefined,
        initialData: fresh ? this.editor.getData() : undefined
      });
    };
    socket.onmessage = event => {
      try {
        this._onMessage(JSON.parse(String(event.data)));
      } catch (error) {
        console.error('collaboration: message failed, resynchronising', error);
        this._resync();
      }
    };
    socket.onclose = () => {
      if (this._socket !== socket) return;
      this._socket = null;
      this._inflight = 0;
      if (this.connectionState === 'denied' || this._destroyed) return;
      this.connectionState = 'offline';
      this.users = [];
      this._clearRemoteMarkers();
      const delay = Math.min(10000, 500 * 2 ** this._retries++);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        void this._connect();
      }, delay);
    };
  }

  private _send(message: Record<string, unknown>): void {
    if (this._socket && this._socket.readyState === 1) this._socket.send(JSON.stringify(message));
  }

  private _onMessage(message: any): void {
    switch (message.type) {
      case 'joined':
        return this._onJoined(message);
      case 'ops':
        return this._receive(message.fromVersion, message.ops);
      case 'ack':
        this._version = message.version;
        this._pending.splice(0, this._inflight);
        this._inflight = 0;
        this._scheduleSnapshot();
        this._flush();
        return;
      case 'reject':
        // Someone else's edits came first: catch up, rebase and send again.
        this._inflight = 0;
        this._receive(message.fromVersion, message.ops);
        this._flush();
        return;
      case 'resync':
        return this._resync();
      case 'user-joined':
        this.users = [...this.users.filter(user => user.clientId !== message.clientId), { clientId: message.clientId, user: message.user, color: message.color, selection: message.selection }];
        this._schedulePresence(true);
        return;
      case 'user-left':
        this.users = this.users.filter(user => user.clientId !== message.clientId);
        this._renderRemoteMarkers();
        return;
      case 'presence': {
        // One cursor move, or several gathered by the server (`updates`, may include our own).
        const updates: Array<{ clientId: number; selection: unknown }> = message.updates || [message];
        const selections = new Map(updates.map(update => [update.clientId, update.selection]));
        this.users = this.users.map(user => (selections.has(user.clientId) ? { ...user, selection: selections.get(user.clientId) as any } : user));
        this._renderRemoteMarkers();
        return;
      }
      case 'threads':
        return this._receiveThreads(message.upserts || [], message.removals || []);
      case 'error':
        if (message.fatal) {
          this.connectionState = 'denied';
          this.editor.enableReadOnlyMode(READ_ONLY_LOCK);
        }
        console.warn(`collaboration: ${message.message}`);
        return;
    }
  }

  private _onJoined(message: any): void {
    const editor = this.editor;
    this._retries = 0;
    this.color = message.color;
    if (message.data !== undefined) {
      // Fresh start from the server's copy.
      this._loading = true;
      try {
        this._pending = [];
        editor.setData(message.data);
        this._clearUndo();
      } finally {
        this._loading = false;
      }
      this._version = message.fromVersion;
      this._applyRemote(message.ops);
      this._version = message.version;
      this._freshJoin = false;
    } else {
      // Reconnected: catch up with what happened meanwhile, then send the offline edits.
      this._receive(message.fromVersion, message.ops);
    }
    this._joined = true;
    this.connectionState = 'connected';
    this.users = message.users || [];
    if (editor.plugins.has('Comments')) {
      const comments = editor.plugins.get('Comments') as any;
      const serverIds = new Set((message.threads || []).map((thread: CommentThread) => thread.id));
      // Threads created offline are sent after the server's ones are merged.
      const localOnly = (comments.getAllThreads() as CommentThread[]).filter(thread => !serverIds.has(thread.id));
      comments.mergeThreads(message.threads || []);
      if (localOnly.length) this._sendThreads();
    }
    editor.disableReadOnlyMode(READ_ONLY_LOCK);
    this._renderRemoteMarkers();
    this._schedulePresence(true);
    this._flush();
  }

  /** Remote operations starting at `fromVersion` (duplicates are skipped). */
  private _receive(fromVersion: number, ops: unknown[]): void {
    if (fromVersion > this._version) return this._resync();
    const fresh = ops.slice(this._version - fromVersion);
    if (!fresh.length) return;
    this._applyRemote(fresh);
    this._version += fresh.length;
    this._renderRemoteMarkers();
  }

  /** Starts again from the server's copy (unsent edits are lost). */
  private _resync(): void {
    if (this._freshJoin) this._noSnapshot = true;
    this._freshJoin = true;
    this._pending = [];
    this._inflight = 0;
    if (this._socket) this._socket.close();
    else void this._connect();
  }

  /* --------------------------------------------------------------------------------------- */
  /* Operations                                                                               */
  /* --------------------------------------------------------------------------------------- */

  private _scheduleFlush(): void {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flush();
    }, this.config?.sendDelay ?? 30);
  }

  private _flush(): void {
    if (!this._joined || this._inflight || !this._pending.length || !this._socket || this._socket.readyState !== 1 || this.connectionState !== 'connected') return;
    this._inflight = this._pending.length;
    this._send({ type: 'ops', version: this._version, ops: this._pending.map(operation => operation.toJSON()) });
  }

  /**
   * Applies remote operations. Unconfirmed local operations are rolled back first and replayed
   * afterwards, with their positions mapped through the remote operations.
   */
  private _applyRemote(jsonOps: unknown[]): void {
    if (!jsonOps.length) return;
    const model = this.editor.model;
    const doc = model.document;
    const graveyard = doc.graveyard;
    const pending = this._pending;
    const rebasing = pending.length > 0;
    // The selection is carried through by hand: when rolled-back text is parked in the graveyard,
    // it stays at that spot instead of following the text.
    const selection = doc.selection;
    let ranges = [...selection.getRanges()].map(range => [range.start, range.end] as [Position, Position]);
    const backward = selection.isBackward;
    this._internal = true;
    try {
      model.enqueueChange({ isUndoable: false, isLocal: false }, writer => {
        const batch = writer.batch;
        for (const marker of [...model.markers]) {
          if (marker.name.startsWith(`${CARET}:`) || marker.name.startsWith(`${SELECTION}:`)) writer.removeMarker(marker.name);
        }
        // Park the selection where nothing will move it (its real place is restored at the end):
        // a live selection inside rolled-back text would follow it into the graveyard.
        writer.setSelection(writer.createPositionAt(doc.getRoot()!, 0));
        const apply = (operation: Operation) => {
          operation.baseVersion = doc.version;
          operation.batch = batch;
          this._applyingOwn = true;
          try {
            model.applyOperation(operation);
          } finally {
            this._applyingOwn = false;
          }
          batch.operations.push(operation);
          ranges = ranges.map(([start, end]) => [mapPosition(start, operation), mapPosition(end, operation)]);
        };

        // 1. Roll back unconfirmed local edits (newest first).
        const reverts: Operation[] = [];
        for (let i = pending.length - 1; i >= 0; i--) {
          const original = pending[i];
          const revert = original.getReversed();
          apply(revert);
          reverts[i] = revert;
          // Rolling back new content parks it in the graveyard; drop it so the graveyard matches
          // the server's (other operations address graveyard positions).
          const parked = original.type === 'insert' ? (original as any).nodes.maxOffset : original.type === 'split' && !(original as any).graveyardPosition ? 1 : 0;
          if (parked) _remove(Range._createFromPositionAndShift(new Position(graveyard, [0]), parked));
        }

        // 2. The remote edits, exactly as everyone else applies them.
        const remote = jsonOps.map(json => normalizeGraveyard(model.createOperationFromJSON(json))).filter(touchesDocument);
        for (const operation of remote) apply(operation);

        // 3. Replay local edits on top, mapped through the rollback, the remote edits and the
        //    already replayed edits. An edit that no longer makes sense is dropped.
        const replayed: Operation[] = [];
        pending.forEach((original, i) => {
          let candidates: Operation[] = [original];
          const chain = [...reverts.slice(0, i).reverse(), ...remote, ...replayed];
          try {
            for (const by of chain) candidates = candidates.flatMap(candidate => transformOperation(candidate, by));
          } catch {
            // The edit cannot be placed after the remote changes (e.g. its paragraph was split
            // differently): it is dropped like any other conflicting edit.
            candidates = [];
          }
          for (const candidate of candidates) {
            // A conflicting edit (e.g. inside content someone else removed) is dropped.
            normalizeGraveyard(candidate);
            if (!touchesDocument(candidate)) continue;
            // A merge takes everything in its source paragraph, which may have changed meanwhile.
            const merge = candidate as any;
            if (merge.type === 'merge') {
              try {
                merge.howMany = merge.sourcePosition.parent.maxOffset - merge.sourcePosition.offset;
              } catch {
                continue;
              }
            }
            if (!isApplicable(candidate)) continue;
            try {
              apply(candidate);
              replayed.push(...this._toWire(candidate));
            } catch {
              // Rejected by the operation itself.
            }
          }
        });
        this._pending = replayed;
        const root = doc.getRoot()!;
        const valid = (position: Position) => (isValidPosition(position) && (position.root as any).rootName !== '$graveyard' ? position : writer.createPositionAt(root, 0));
        writer.setSelection(
          ranges.map(([start, end]) => {
            const [a, b] = [valid(start), valid(end)];
            return a.isAfter(b) ? writer.createRange(b, a) : writer.createRange(a, b);
          }),
          { backward }
        );
      });
    } finally {
      this._internal = false;
    }
    if (this._pending.length) this._scheduleFlush();
    // Undo steps refer to the edits as they were before the rebase.
    if (rebasing) this._clearUndo();
  }

  /**
   * The shareable form of an operation that was just applied, as detached copies (operations hold
   * the nodes they inserted, which keep changing as editing continues).
   *
   * Each client's graveyard (removed content kept for undo) depends on its own history, so shared
   * operations never depend on it: content brought back from the graveyard is sent as an explicit
   * insertion (or a plain split plus rename and attribute changes), and removals all go to its front.
   */
  private _toWire(operation: Operation): Operation[] {
    const model = this.editor.model;
    const graveyard = model.document.graveyard;
    const op = operation as any;
    const copy = (item: Operation) => normalizeGraveyard(model.createOperationFromJSON(JSON.parse(JSON.stringify(item.toJSON()))));
    // Changes inside the graveyard only (e.g. formatting text someone else deleted) are local.
    if (!touchesDocument(operation)) return [];
    if (operation instanceof MoveOperation && op.sourcePosition.root === graveyard && op.targetPosition.root !== graveyard) {
      const moved = Range._createFromPositionAndShift(op.getMovedRangeStart(), op.howMany);
      const nodes = [...moved.getItems({ shallow: true })].map((item: any) => (item.is('$textProxy') ? new Text(item.data, item.getAttributes()) : item._clone(true)));
      return [copy(new InsertOperation(op.targetPosition, nodes, null))];
    }
    if (op.type === 'split' && op.graveyardPosition) {
      const parent = op.splitPosition.parent;
      const created = op.insertionPosition.nodeAfter;
      const result: Operation[] = [new SplitOperation(op.splitPosition, op.howMany, op.insertionPosition, null, null)];
      if (created && created.name !== parent.name) result.push(new RenameOperation(op.insertionPosition, parent.name, created.name, null));
      if (created) {
        const range = new Range(op.insertionPosition, op.insertionPosition.getShiftedBy(1));
        for (const key of new Set([...parent.getAttributeKeys(), ...created.getAttributeKeys()])) {
          const before = parent.getAttribute(key);
          const after = created.getAttribute(key);
          if (before !== after) result.push(new AttributeOperation(range, key, before ?? null, after ?? null, null));
        }
      }
      return result.map(copy);
    }
    return [copy(operation)];
  }

  private _clearUndo(): void {
    for (const name of ['undo', 'redo']) (this.editor.commands.get(name) as any)?.clearStack?.();
  }

  /** The current HTML, so late joiners and the host application get an up-to-date copy. */
  private _scheduleSnapshot(): void {
    if (this._snapshotTimer) clearTimeout(this._snapshotTimer);
    this._snapshotTimer = setTimeout(() => {
      this._snapshotTimer = null;
      if (!this._pending.length && this._version > this._lastSnapshotVersion && this.connectionState === 'connected') {
        this._lastSnapshotVersion = this._version;
        this._send({ type: 'snapshot', version: this._version, data: this.editor.getData() });
      }
    }, 1500);
  }

  /* --------------------------------------------------------------------------------------- */
  /* Comment threads                                                                          */
  /* --------------------------------------------------------------------------------------- */

  private _rememberThreads(threads: CommentThread[]): void {
    this._sentThreads = new Map(threads.map(thread => [thread.id, JSON.stringify(thread)]));
  }

  private _sendThreads(): void {
    if (!this._joined || !this.editor.plugins.has('Comments')) return;
    const threads = (this.editor.plugins.get('Comments') as any).getAllThreads() as CommentThread[];
    const current = new Map(threads.map(thread => [thread.id, JSON.stringify(thread)]));
    const upserts = threads.filter(thread => this._sentThreads.get(thread.id) !== current.get(thread.id));
    const removals = [...this._sentThreads.keys()].filter(id => !current.has(id));
    if (!upserts.length && !removals.length) return;
    // The anchors (content) go first.
    this._flush();
    this._send({ type: 'threads', upserts, removals });
    this._sentThreads = current;
  }

  private _receiveThreads(upserts: CommentThread[], removals: string[]): void {
    if (!this.editor.plugins.has('Comments')) return;
    (this.editor.plugins.get('Comments') as any).mergeThreads(upserts, removals);
  }

  /* --------------------------------------------------------------------------------------- */
  /* Presence                                                                                 */
  /* --------------------------------------------------------------------------------------- */

  private _schedulePresence(immediate = false): void {
    if (this._presenceTimer) clearTimeout(this._presenceTimer);
    this._presenceTimer = setTimeout(() => {
      this._presenceTimer = null;
      if (this.connectionState !== 'connected') return;
      const selection = this.editor.model.document.selection;
      const toData = (position: any): PositionData => ({ root: position.root.rootName, path: position.path });
      const anchor = selection.anchor;
      const focus = selection.focus;
      this._send({ type: 'presence', selection: anchor && focus ? { anchor: toData(anchor), focus: toData(focus) } : null });
    }, immediate ? 0 : 80);
  }

  private _setUpPresenceConversion(): void {
    const conversion = this.editor.conversion;
    const userOf = (markerName: string) => this.users.find(user => String(user.clientId) === markerName.split(':')[1]);
    conversion.for('editingDowncast').markerToHighlight({
      model: SELECTION,
      view: (data: any) => {
        const user = userOf(data.markerName);
        return { classes: ['ck-user-selection', `ck-user-color-${user ? user.color : 0}`], priority: 1 };
      }
    });
    conversion.for('editingDowncast').markerToElement({
      model: CARET,
      view: (data: any, { writer }: any) => {
        const user = userOf(data.markerName);
        const name = user ? user.user.name : '';
        return writer.createUIElement('span', { class: `ck-user-caret ck-user-color-${user ? user.color : 0}` }, function (this: any, domDocument: Document) {
          const dom = this.toDomElement(domDocument);
          dom.innerHTML = `<span class="ck-user-caret__name">${escapeHtml(name)}</span>`;
          return dom;
        });
      }
    });
  }

  private _renderRemoteMarkers(): void {
    const model = this.editor.model;
    const wanted = new Map<string, Range>();
    for (const user of this.users) {
      const selection = user.selection;
      if (!selection) continue;
      try {
        const anchor = model.createPositionFromPath(model.document.getRoot(selection.anchor.root)!, selection.anchor.path);
        const focus = model.createPositionFromPath(model.document.getRoot(selection.focus.root)!, selection.focus.path);
        wanted.set(`${CARET}:${user.clientId}`, model.createRange(focus));
        if (!anchor.isEqual(focus)) wanted.set(`${SELECTION}:${user.clientId}`, anchor.isBefore(focus) ? model.createRange(anchor, focus) : model.createRange(focus, anchor));
      } catch {
        // Their position is not valid here yet (edits still on the way); the next update fixes it.
      }
    }
    {
      // A local batch: markers need no operations, and anything post-fixers do here is shared.
      model.enqueueChange({ isUndoable: false }, writer => {
        for (const marker of [...model.markers]) {
          if (!marker.name.startsWith(`${CARET}:`) && !marker.name.startsWith(`${SELECTION}:`)) continue;
          const range = wanted.get(marker.name);
          if (!range) writer.removeMarker(marker.name);
          else {
            if (!marker.getRange().isEqual(range)) writer.updateMarker(marker.name, { range });
            wanted.delete(marker.name);
          }
        }
        for (const [name, range] of wanted) writer.addMarker(name, { range, usingOperation: false, affectsData: false });
      });
    }
  }

  private _clearRemoteMarkers(): void {
    this.users = [];
    this._renderRemoteMarkers();
  }

  /* --------------------------------------------------------------------------------------- */
  /* UI                                                                                       */
  /* --------------------------------------------------------------------------------------- */

  private _addUI(): void {
    const editor = this.editor;
    editor.ui.componentFactory.add('collaborators', locale => new CollaboratorsView(locale, editor, this));
  }
}

/** Whether an operation changes the document (and not only the graveyard). */
function touchesDocument(operation: Operation): boolean {
  const op = operation as any;
  const roots = [op.position, op.sourcePosition, op.targetPosition, op.splitPosition, op.insertionPosition, op.range && op.range.start].filter(Boolean).map((position: Position) => (position.root as any).rootName);
  return roots.length === 0 || roots.some((name: string) => name !== '$graveyard');
}

/** Sends removed content to the front of the graveyard, whatever position the operation had. */
function normalizeGraveyard(operation: Operation): Operation {
  const op = operation as any;
  if (operation instanceof MoveOperation && op.targetPosition.root.rootName === '$graveyard') op.targetPosition = new Position(op.targetPosition.root, [0]);
  if (op.type === 'merge' && op.graveyardPosition) op.graveyardPosition = new Position(op.graveyardPosition.root, [0]);
  return operation;
}

/** Whether the position points into the current tree (its parent exists and the offset fits). */
function isValidPosition(position: Position): boolean {
  try {
    const parent = (position as any).parent;
    if (!parent || position.offset > parent.maxOffset) return false;
    void (position as any).index;
    return true;
  } catch {
    return false;
  }
}

/** Checks every position an operation touches before it is applied, so a failed edit leaves no trace. */
function isApplicable(operation: Operation): boolean {
  const op = operation as any;
  const positions: Position[] = [];
  for (const key of ['position', 'sourcePosition', 'targetPosition', 'splitPosition', 'insertionPosition', 'graveyardPosition']) {
    if (op[key]) positions.push(op[key]);
  }
  if (op.range) positions.push(op.range.start, op.range.end);
  if (operation instanceof MoveOperation || op.type === 'merge') {
    try {
      const end = op.sourcePosition.getShiftedBy(op.howMany);
      positions.push(end);
      // Content cannot move into itself.
      if (operation instanceof MoveOperation && Range._createFromPositionAndShift(op.sourcePosition, op.howMany).containsPosition(op.targetPosition)) return false;
    } catch {
      return false;
    }
  }
  if (!positions.every(isValidPosition)) return false;
  try {
    // Rebased merges and splits must keep their shape: a merge appends a paragraph to the end of
    // the one right before it; a split puts the new paragraph right after the split one.
    if (op.type === 'merge') {
      const source = op.sourcePosition.parent;
      const target = op.targetPosition.parent;
      if (op.sourcePosition.offset !== 0 || op.targetPosition.offset !== target.maxOffset || !source.parent || source.parent !== target.parent || source.index !== target.index + 1) return false;
    }
    if (op.type === 'split' && !op.graveyardPosition) {
      const element = op.splitPosition.parent;
      if (!element.parent || op.insertionPosition.parent !== element.parent || op.insertionPosition.offset !== element.index + 1) return false;
    }
    op._validate();
    return true;
  } catch {
    return false;
  }
}

/** Maps a position through an operation; positions inside removed content stay where it was. */
function mapPosition(position: Position, operation: Operation): Position {
  const op = operation as any;
  if (operation instanceof MoveOperation && op.targetPosition.root.rootName === '$graveyard' && op.sourcePosition.root === position.root) {
    const removed = Range._createFromPositionAndShift(op.sourcePosition, op.howMany);
    if (removed.containsPosition(position)) return op.sourcePosition;
  }
  try {
    return position.getTransformedByOperation(operation);
  } catch {
    return position;
  }
}

/** Avatars of the people in the document plus the connection state. */
class CollaboratorsView extends View {
  constructor(locale: Locale, private readonly _editor: Editor, private readonly _plugin: RealTimeCollaboration) {
    super(locale);
    this.setTemplate({ tag: 'div', attributes: { class: ['ck', 'ck-collaborators'], role: 'status', 'aria-live': 'polite' } });
    this.on('render', () => {
      const update = () => this._update();
      _plugin.on('change:users', update);
      _plugin.on('change:connectionState', update);
      _plugin.on('change:color', update);
      update();
    });
  }

  public focus(): void {
    // Informational only.
  }

  private _update(): void {
    const element = this.element;
    if (!element) return;
    const t = this._editor.t;
    const plugin = this._plugin;
    const me = getEditorUser(this._editor);
    const labels: Record<ConnectionState, string> = { connecting: t('Connecting…'), connected: t('Live'), offline: t('Offline: edits will sync'), denied: t('No access') };
    const avatar = (user: EditorUser, color: number, self: boolean) =>
      `<span class="ck-collaborators__avatar ck-user-color-${color}" title="${escapeHtml(self ? `${user.name} (${t('you')})` : user.name)}">${escapeHtml(initials(user.name))}</span>`;
    element.innerHTML =
      `<span class="ck-collaborators__state ck-collaborators__state_${plugin.connectionState}">${escapeHtml(labels[plugin.connectionState])}</span>` +
      `<span class="ck-collaborators__avatars">${avatar(me, plugin.color, true)}${plugin.users.map(user => avatar(user.user, user.color, false)).join('')}</span>`;
  }
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map(part => part[0] || '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/**
 * Adds the document id to the server address (`?doc=…`), so a load balancer in front of several
 * collaboration servers can send everyone editing the same document to the same server.
 */
function withDocumentId(url: string, documentId: string): string {
  if (/[?&]doc=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}doc=${encodeURIComponent(documentId)}`;
}
