import { describe, it, expect } from 'vitest';
import { clickOutsideHandler } from './bindings';
import { Emitter } from '../utils/emitter';

describe('clickOutsideHandler', () => {
  function setUp() {
    const panel = document.createElement('div');
    const child = document.createElement('span');
    panel.appendChild(child);
    document.body.appendChild(panel);
    let calls = 0;
    const emitter = new Emitter();
    clickOutsideHandler({ emitter, activator: () => true, contextElements: () => [panel], callback: () => calls++ });
    return { panel, child, emitter, calls: () => calls };
  }

  it('ignores clicks inside and reacts to clicks outside', () => {
    const { child, emitter, calls } = setUp();
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(calls()).toBe(0);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(calls()).toBe(1);
    emitter.stopListening();
  });

  it('treats a click on an element that is redrawn on mousedown as inside (the formula editor)', () => {
    const { panel, child, emitter, calls } = setUp();
    // Like the formula canvas: the clicked node is replaced before the document sees the event.
    panel.addEventListener('mousedown', () => panel.replaceChildren(document.createElement('span')));
    child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(child.isConnected).toBe(false);
    expect(calls()).toBe(0);
    emitter.stopListening();
  });
});
