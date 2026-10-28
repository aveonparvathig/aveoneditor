import type { Node } from './node';
import type { TextProxy } from './textproxy';

/** Item returned by tree walkers: a node or a text proxy. */
export type Item = Node | TextProxy;
