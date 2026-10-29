import type * as rdfjs from "@rdfjs/types";
import { DataFactory } from "@/term/mod.ts";
import type { MemoryStore as Store } from "@/store/memory-store.ts";
import type { WazooSparqlTransaction } from "@/wazoo-sparql-engine.ts";

const { namedNode } = DataFactory;

export const exampleP = namedNode("http://example.org/p");
export const exampleQ = namedNode("http://example.org/q");
export const exampleV = namedNode("http://example.org/v");
export const exampleA = namedNode("http://example.org/a");

/**
 * RecordingTransaction is a fake WazooSparqlTransaction that records every
 * buffered add/delete and, when applyOnCommit is set, applies them to the
 * backing store at commit time. It can be told to fail on commit to exercise
 * the rollback path.
 */
export class RecordingTransaction implements WazooSparqlTransaction {
  public readonly added: rdfjs.Quad[] = [];
  public readonly deleted: rdfjs.Quad[] = [];
  public committed = false;
  public rolledBack = false;
  public failCommit = false;

  public constructor(
    private readonly store: Store,
    private readonly applyOnCommit = true,
  ) {}

  public add(item: rdfjs.Quad): void {
    this.added.push(item);
  }

  public delete(item: rdfjs.Quad): void {
    this.deleted.push(item);
  }

  public commit(): Promise<void> {
    if (this.failCommit) {
      return Promise.reject(new Error("commit failed"));
    }
    if (this.applyOnCommit) {
      for (const item of this.added) {
        this.store.addQuad(item);
      }
      for (const item of this.deleted) {
        this.store.removeQuad(item);
      }
    }
    this.committed = true;
    return Promise.resolve();
  }

  public rollback(): void {
    this.rolledBack = true;
  }
}
