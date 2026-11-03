/**
 * Deterministic collaboration simulation: an in-process server and sockets whose messages are
 * delivered in an order chosen by a seeded random generator. The same seed always reproduces the
 * same interleaving, so any divergence can be replayed exactly. Timers with a delay (cursor updates,
 * snapshots) run on a simulated clock driven by the seed too, so they cannot depend on how fast the
 * machine is.
 */

import { describe, it, expect } from 'vitest';
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import type { RealTimeCollaboration } from './collaboration';

interface Delivery {
  socket: FakeSocket;
  data: string;
}

/** Minimal version of the server's ordering logic (see packages/collab-server). */
class Hub {
  public ops: unknown[] = [];
  public queue: Delivery[] = [];
  public sockets: FakeSocket[] = [];
  public clock: Clock | null = null;
  private _nextId = 1;
  private _initialData: string | null = null;

  public toClient(socket: FakeSocket, message: unknown): void {
    this.queue.push({ socket, data: JSON.stringify(message) });
  }

  public fromClient(socket: FakeSocket, raw: string): void {
    const message = JSON.parse(raw);
    if (message.type === 'join') {
      socket.clientId = this._nextId++;
      if (this._initialData === null) this._initialData = message.initialData;
      const users = this.sockets.map(other => ({ clientId: other.clientId, user: { id: String(other.clientId), name: 'U' + other.clientId }, color: 0, selection: null }));
      this.sockets.push(socket);
      this.toClient(socket, { type: 'joined', clientId: socket.clientId, color: 0, version: this.ops.length, users, threads: [], data: this._initialData, fromVersion: 0, ops: this.ops.slice() });
      for (const other of this.sockets) if (other !== socket) this.toClient(other, { type: 'user-joined', clientId: socket.clientId, user: { id: String(socket.clientId), name: 'U' + socket.clientId }, color: 0, selection: null });
    } else if (message.type === 'presence') {
      // Sent in the server's batched form (which includes the sender's own entry).
      for (const other of this.sockets) this.toClient(other, { type: 'presence', updates: [{ clientId: socket.clientId, selection: message.selection }] });
    } else if (message.type === 'ops') {
      if (message.version !== this.ops.length) {
        // Like the server: the newer operations already reached the client (broadcast, in order).
        this.toClient(socket, { type: 'reject', fromVersion: this.ops.length, ops: [] });
        return;
      }
      const fromVersion = this.ops.length;
      this.ops.push(...message.ops);
      this.toClient(socket, { type: 'ack', version: this.ops.length });
      for (const other of this.sockets) if (other !== socket) this.toClient(other, { type: 'ops', fromVersion, ops: message.ops, clientId: socket.clientId });
    }
  }
}

class FakeSocket {
  public static hub: Hub;
  public readyState = 0;
  public clientId = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public outbox: string[] = [];

  constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  public send(data: string): void {
    // Client → server messages are delivered later too (shuffled with the rest).
    this.outbox.push(data);
  }

  public close(): void {
    this.readyState = 3;
  }
}

function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function client(name: string, html: string) {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  const editor = await ClassicEditor.create(element, {
    ...classicDefaultConfig,
    plugins: classicPreset,
    user: { id: name, name },
    collaboration: { url: 'fake://hub', documentId: 'sim', WebSocket: FakeSocket as any, sendDelay: 0 }
  });
  return editor;
}

/** A clock for timers with a delay; each delivered message advances it by a random amount. */
class Clock {
  private _now = 0;
  private _nextId = 1;
  private _timers = new Map<number, { at: number; callback: () => void }>();
  private _original = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };

  constructor(private readonly _random: () => number) {
    const original = this._original;
    (globalThis as any).setTimeout = (callback: (...args: any[]) => void, delay = 0, ...args: any[]) => {
      // Zero delays stay real: the simulation awaits them.
      if (!delay) return original.setTimeout(callback, 0, ...args);
      const id = -this._nextId++;
      this._timers.set(id, { at: this._now + delay, callback: () => callback(...args) });
      return id;
    };
    (globalThis as any).clearTimeout = (id: any) => (this._timers.has(id) ? this._timers.delete(id) : original.clearTimeout(id));
  }

  public tick(): void {
    this._now += Math.floor(this._random() * 40);
    for (const [id, timer] of [...this._timers]) {
      if (timer.at <= this._now && this._timers.delete(id)) timer.callback();
    }
  }

  public restore(): void {
    Object.assign(globalThis, this._original);
  }
}

/** Delivers one pending message (to or from the server), chosen at random. */
function pump(hub: Hub, random: () => number): boolean {
  hub.clock?.tick();
  const sources: Array<() => void> = [];
  for (const socket of hub.sockets.concat()) {
    if (socket.outbox.length) sources.push(() => hub.fromClient(socket, socket.outbox.shift()!));
  }
  // Per-socket order is preserved (like TCP): only the first message of each socket is eligible.
  const firstPerSocket = new Map<FakeSocket, number>();
  hub.queue.forEach((delivery, index) => {
    if (!firstPerSocket.has(delivery.socket)) firstPerSocket.set(delivery.socket, index);
  });
  for (const index of firstPerSocket.values()) {
    sources.push(() => {
      const [delivery] = hub.queue.splice(index, 1);
      delivery.socket.onmessage?.({ data: delivery.data });
    });
  }
  if (!sources.length) return false;
  sources[Math.floor(random() * sources.length)]();
  return true;
}

async function settle(hub: Hub, random: () => number, editors: ClassicEditor[]): Promise<void> {
  for (let i = 0; i < 10000; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    // Joining sockets are registered on the hub by their first message.
    for (const editor of editors) {
      const socket = (editor.plugins.get('RealTimeCollaboration') as any)._socket as FakeSocket | null;
      if (socket && !hub.sockets.includes(socket) && socket.outbox.length) hub.fromClient(socket, socket.outbox.shift()!);
    }
    if (!pump(hub, random)) {
      const idle = editors.every(editor => (editor.plugins.get('RealTimeCollaboration') as RealTimeCollaboration).isSynced);
      if (idle) return;
    }
  }
  throw new Error('Simulation did not settle');
}

async function run(seed: number, rounds: number): Promise<{ errors: string[]; data: string[] }> {
  const hub = new Hub();
  FakeSocket.hub = hub;
  const random = rng(seed);
  const clock = (hub.clock = new Clock(rng(seed * 7919 + 1)));
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => errors.push(String(args[1]?.stack || args[1] || args[0]));
  const editors: ClassicEditor[] = [];
  try {
    editors.push(await client('A', '<p>alpha beta</p><p>gamma delta</p><p>epsilon</p>'));
    await settle(hub, random, editors);
    editors.push(await client('B', '<p>x</p>'));
    editors.push(await client('C', '<p>x</p>'));
    await settle(hub, random, editors);
    for (let round = 0; round < rounds; round++) {
      for (const editor of editors) {
        const root = editor.model.document.getRoot()!;
        const element = root.getChild(Math.floor(random() * root.childCount)) as any;
        if (!element || !element.is('element')) continue;
        const max = element.maxOffset;
        const offset = Math.floor(random() * (max + 1));
        const action = random();
        editor.model.change(writer => writer.setSelection(writer.createPositionAt(element, offset)));
        if (action < 0.45) editor.execute('insertText', { text: 'xyz'.slice(0, 1 + Math.floor(random() * 3)) });
        else if (action < 0.7 && max > 0) editor.execute('delete');
        else if (action < 0.82) editor.execute('enter');
        else if (max > 1) {
          editor.model.change(writer => writer.setSelection(writer.createRange(writer.createPositionAt(element, 0), writer.createPositionAt(element, Math.min(max, 2)))));
          editor.execute('italic');
        }
      }
      // Deliver a random number of messages between rounds.
      const steps = Math.floor(random() * 6);
      for (let i = 0; i < steps; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
        pump(hub, random);
      }
    }
    await settle(hub, random, editors);
    return { errors, data: editors.map(editor => editor.getData()) };
  } finally {
    console.error = originalError;
    for (const editor of editors) {
      const element = editor.sourceElement;
      await editor.destroy();
      element?.remove();
    }
    clock.restore();
  }
}

describe('collaboration simulation', () => {
  const env = ((globalThis as any).process?.env || {}) as Record<string, string | undefined>;
  const seeds = Array.from({ length: Number(env.SIM_SEEDS || 30) }, (_, i) => Number(env.SIM_START || 1) + i);
  // Seeds that once failed: a remote cursor ahead of this copy's content broke rendering (18, 44).
  if (!env.SIM_SEEDS) seeds.push(44);
  it.each(seeds)('converges without resyncs (seed %i)', async seed => {
    const { errors, data } = await run(seed, 20);
    expect(errors).toEqual([]);
    expect(new Set(data).size).toBe(1);
  }, 30000);
});
