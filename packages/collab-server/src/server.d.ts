import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { WebSocketServer } from 'ws';

export interface CollaborationUser {
  id: string;
  name: string;
}

export interface DocumentState {
  initialData: string;
  snapshot: { version: number; data: string } | null;
  opsStart: number;
  ops: unknown[];
  threads: unknown[];
}

export interface CollaborationStorage {
  load(documentId: string): Promise<DocumentState | null>;
  save(documentId: string, state: DocumentState): Promise<void>;
}

export declare class FileStorage implements CollaborationStorage {
  constructor(directory: string);
  load(documentId: string): Promise<DocumentState | null>;
  save(documentId: string, state: DocumentState): Promise<void>;
}

export declare class MemoryStorage implements CollaborationStorage {
  load(documentId: string): Promise<DocumentState | null>;
  save(documentId: string, state: DocumentState): Promise<void>;
}

export type SqlDialect = 'postgres' | 'mssql' | 'mysql' | 'sqlite';

export interface SqlStorageOptions {
  dialect?: SqlDialect;
  /** Runs a statement and resolves to the result rows. */
  query(sql: string, params: unknown[]): Promise<Array<Record<string, unknown>>>;
  table?: string;
  createTable?: boolean;
}

export declare class SqlStorage implements CollaborationStorage {
  constructor(options: SqlStorageOptions);
  static postgres(pool: { query(sql: string, params: unknown[]): Promise<{ rows: any[] }> }, options?: Partial<SqlStorageOptions>): SqlStorage;
  static mssql(pool: { request(): any }, options?: Partial<SqlStorageOptions>): SqlStorage;
  static mysql(pool: { query(sql: string, params: unknown[]): Promise<any> }, options?: Partial<SqlStorageOptions>): SqlStorage;
  static sqlite(db: { prepare(sql: string): any }, options?: Partial<SqlStorageOptions>): SqlStorage;
  load(documentId: string): Promise<DocumentState | null>;
  save(documentId: string, state: DocumentState): Promise<void>;
}

export interface CollaborationServerOptions {
  port?: number;
  server?: HttpServer;
  path?: string;
  storage?: CollaborationStorage;
  authenticate?(context: { token?: string; documentId: string; user: CollaborationUser; request: IncomingMessage }): CollaborationUser | boolean | null | Promise<CollaborationUser | boolean | null>;
  onSnapshot?(snapshot: { documentId: string; version: number; data: string }): void | Promise<void>;
  keepOperations?: number;
  saveDelay?: number;
  maxPayload?: number;
  /** Milliseconds cursor moves are gathered before being sent (default 50). */
  presenceInterval?: number;
}

export interface CollaborationServer {
  readonly wss: WebSocketServer;
  readonly port: number;
  ready(): Promise<void>;
  /** Load figures: open connections and documents, and totals since start. */
  stats(): { connections: number; documents: number; operations: number; rejects: number; resyncs: number };
  users(documentId: string): Array<{ clientId: number; user: CollaborationUser; color: number; selection: unknown }>;
  close(): Promise<void>;
}

export declare function createCollaborationServer(options?: CollaborationServerOptions): CollaborationServer;
