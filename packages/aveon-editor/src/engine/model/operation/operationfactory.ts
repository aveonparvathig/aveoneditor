import { AttributeOperation } from './attributeoperation';
import { InsertOperation } from './insertoperation';
import { MarkerOperation } from './markeroperation';
import { MoveOperation } from './moveoperation';
import { NoOperation } from './nooperation';
import { Operation } from './operation';
import { RenameOperation } from './renameoperation';
import { RootAttributeOperation } from './rootattributeoperation';
import { SplitOperation } from './splitoperation';
import { MergeOperation } from './mergeoperation';
import type { Document } from '../document';

const operations: Record<string, any> = {
  AttributeOperation,
  InsertOperation,
  MarkerOperation,
  MoveOperation,
  NoOperation,
  Operation,
  RenameOperation,
  RootAttributeOperation,
  SplitOperation,
  MergeOperation
};

export class OperationFactory {
  public static fromJSON(json: any, document: Document): Operation {
    return operations[json.__className].fromJSON(json, document);
  }
}
