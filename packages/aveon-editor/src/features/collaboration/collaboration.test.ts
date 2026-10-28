/**
 * Real-time collaboration against a real server: several editors connected over WebSockets edit
 * the same document at the same time and must end up with identical content.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Real WebSocket round trips with several editors: allow for a busy machine.
vi.setConfig({ testTimeout: 20000 });
import { ClassicEditor } from '../../builds/classiceditor';
import { classicPreset, classicDefaultConfig } from '../../builds/presets';
import { createCollaborationServer, MemoryStorage, type CollaborationServer } from '../../../../collab-server/src/server.js';
import type { RealTimeCollaboration } from './collaboration';
import type { Comments } from '../comments/comments';

let server: CollaborationServer;
let WebSocketImpl: any;
let documentCounter = 0;

beforeAll(async () => {
  const name = 'ws';
  WebSocketImpl = (await import(/* @vite-ignore */ name)).WebSocket;
  server = createCollaborationServer({ port: 0, storage: new MemoryStorage(), saveDelay: 10 });
  await server.ready();
});

afterAll(async () => {
  await server.close();
});

async function join(documentId: string, name: string, html = '<p>Hello world</p>') {
  const element = document.createElement('div');
  element.innerHTML = html;
  document.body.appendChild(element);
  const editor = await ClassicEditor.create(element, {
    ...classicDefaultConfig,
    plugins: classicPreset,
    user: { id: name.toLowerCase(), name },
    collaboration: { url: `ws://localhost:${server.port}`, documentId, WebSocket: WebSocketImpl, sendDelay: 5 }
  });
  const collaboration = editor.plugins.get('RealTimeCollaboration') as RealTimeCollaboration;
  await waitFor(() => collaboration.connectionState === 'connected');
  return { editor, collaboration };
}

function waitFor(predicate: () => boolean, timeout = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('Timed out'));
      setTimeout(check, 10);
    };
    check();
  });
}

type Peer = Awaited<ReturnType<typeof join>>;

/** Waits until everyone has sent everything and all copies are the same. */
async function converged(...peers: Peer[]): Promise<string> {
  await waitFor(() => {
    if (!peers.every(peer => peer.collaboration.isSynced)) return false;
    const version = peers[0].collaboration.version;
    return peers.every(peer => peer.collaboration.version === version);
  });
  const data = peers[0].editor.getData();
  for (const peer of peers) expect(peer.editor.getData()).toBe(data);
  return data;
}

function type(peer: Peer, block: number, offset: number | 'end', text: string): void {
  const { editor } = peer;
  editor.model.change(writer => writer.setSelection(editor.model.document.getRoot()!.getChild(block) as any, offset));
  editor.execute('insertText', { text });
}

async function destroy(...peers: Peer[]): Promise<void> {
  for (const peer of peers) await peer.editor.destroy();
}

describe('real-time collaboration', () => {
  it('shares edits and starts late joiners from the shared copy', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha');
    const b = await join(id, 'Ben', '<p>Ignored: the room already exists</p>');
    expect(b.editor.getData()).toBe('<p>Hello world</p>');

    type(a, 0, 'end', '!');
    await converged(a, b);
    expect(b.editor.getData()).toBe('<p>Hello world!</p>');

    b.editor.execute('heading', { value: 'heading1' });
    a.editor.execute('bold');
    const data = await converged(a, b);

    const c = await join(id, 'Cleo');
    expect(c.editor.getData()).toBe(data);
    await destroy(a, b, c);
  });

  it('merges simultaneous edits in the same paragraph', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha');
    const b = await join(id, 'Ben');
    // Both type before seeing each other's change.
    type(a, 0, 0, 'Oh, ');
    type(b, 0, 'end', ' again');
    type(a, 0, 6, 'big ');
    const data = await converged(a, b);
    expect(data).toContain('Oh, ');
    expect(data).toContain('big ');
    expect(data).toContain(' again');
    await destroy(a, b);
  });

  it('stays consistent when someone deletes text another person is editing', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha', '<p>First</p><p>Second</p><p>Third</p>');
    const b = await join(id, 'Ben');
    await converged(a, b);
    a.editor.model.change(writer => writer.remove(a.editor.model.document.getRoot()!.getChild(1) as any));
    type(b, 1, 3, 'XYZ');
    b.editor.execute('enter');
    type(b, 2, 0, 'new');
    await converged(a, b);
    await destroy(a, b);
  });

  it.each([42, 7, 1234, 99, 2026])('keeps copies identical under random simultaneous editing by three people (seed %i)', async startSeed => {
    const id = `doc-${++documentCounter}`;
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    const peers = [await join(id, 'Asha', '<p>alpha beta</p><p>gamma delta</p><p>epsilon</p>'), await join(id, 'Ben'), await join(id, 'Cleo')];
    let seed = startSeed;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let round = 0; round < 20; round++) {
      for (const peer of peers) {
        const { editor } = peer;
        const root = editor.model.document.getRoot()!;
        const block = Math.floor(random() * root.childCount);
        const element = root.getChild(block) as any;
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
      if (round % 4 === 3) await new Promise(resolve => setTimeout(resolve, 15));
    }
    await converged(...peers);
    console.error = originalError;
    // No client had to fall back to a full reload of the document.
    expect(errors.map((e: any) => String(e[1]?.stack || e[1]).split('\n').slice(0, 9).join(' // '))).toEqual([]);
    await destroy(...peers);
  }, 20000);

  it('shows who is connected and where their cursor is', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha');
    const b = await join(id, 'Ben');
    await waitFor(() => a.collaboration.users.some(user => user.user.name === 'Ben'));
    b.editor.model.change(writer => writer.setSelection(b.editor.model.document.getRoot()!.getChild(0) as any, 5));
    await waitFor(() => !!a.editor.ui.getEditableElement()!.querySelector('.ck-user-caret'));
    expect(a.editor.ui.getEditableElement()!.querySelector('.ck-user-caret__name')!.textContent).toBe('Ben');
    await b.editor.destroy();
    await waitFor(() => !a.collaboration.users.length && !a.editor.ui.getEditableElement()!.querySelector('.ck-user-caret'));
    await a.editor.destroy();
  });

  it('shares comment threads', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha');
    const b = await join(id, 'Ben');
    a.editor.model.change(writer => {
      const paragraph = a.editor.model.document.getRoot()!.getChild(0) as any;
      writer.setSelection(writer.createRange(writer.createPositionAt(paragraph, 0), writer.createPositionAt(paragraph, 5)));
    });
    const threadId = (await a.editor.execute('addComment', { text: 'Check this' })) as unknown as string;
    const commentsB = b.editor.plugins.get('Comments') as Comments;
    await waitFor(() => commentsB.getThreads().length === 1);
    commentsB.reply(threadId, 'Done');
    const commentsA = a.editor.plugins.get('Comments') as Comments;
    await waitFor(() => commentsA.getThread(threadId)?.replies.length === 1);
    expect(commentsA.getThread(threadId)!.replies[0].author.name).toBe('Ben');
    await destroy(a, b);
  });

  it('keeps edits made while offline and sends them after reconnecting', async () => {
    const id = `doc-${++documentCounter}`;
    const a = await join(id, 'Asha');
    const b = await join(id, 'Ben');
    a.collaboration.disconnect();
    await waitFor(() => a.collaboration.connectionState === 'offline');
    type(a, 0, 'end', ' (offline)');
    type(b, 0, 0, 'Online: ');
    await new Promise(resolve => setTimeout(resolve, 50));
    a.collaboration.reconnect();
    await waitFor(() => a.collaboration.connectionState === 'connected');
    const data = await converged(a, b);
    expect(data).toBe('<p>Online: Hello world (offline)</p>');
    await destroy(a, b);
  });
});
