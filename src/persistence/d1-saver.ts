import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointTuple,
  type ChannelVersions,
} from "@langchain/langgraph-checkpoint";
import type { CheckpointMetadata, CheckpointPendingWrite, PendingWrite } from "@langchain/langgraph-checkpoint";

/**
 * LangGraph checkpointer backed by Cloudflare D1 (SQLite).
 * Implements the 4 abstract methods of BaseCheckpointSaver.
 */
export class D1Saver extends BaseCheckpointSaver {
  private db: D1Database;

  constructor(db: D1Database) {
    super();
    this.db = db;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? "") as string;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    if (!threadId) return undefined;

    let row: Record<string, unknown> | null;

    if (checkpointId) {
      const stmt = this.db.prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
         FROM checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`
      );
      row = await stmt.bind(threadId, checkpointNs, checkpointId).first();
    } else {
      const stmt = this.db.prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
         FROM checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC LIMIT 1`
      );
      row = await stmt.bind(threadId, checkpointNs).first();
    }

    if (!row) return undefined;

    const cpId = row.checkpoint_id as string;
    const parentId = row.parent_checkpoint_id as string | null;
    const type = (row.type as string) || "json";
    const cpData = row.checkpoint as string;
    const metaData = (row.metadata as string) || "{}";

    const checkpoint = this.serde.loadsTyped(type, cpData) as Checkpoint;
    const metadata = JSON.parse(metaData) as CheckpointMetadata;

    const writesStmt = this.db.prepare(
      `SELECT task_id, channel, type, value
       FROM checkpoint_writes
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY idx`
    );
    const writesResult = await writesStmt.bind(threadId, checkpointNs, cpId).all();
    const pendingWrites: CheckpointPendingWrite[] = (writesResult.results || []).map((w) => {
      const wType = (w.type as string) || "json";
      const value = this.serde.loadsTyped(wType, w.value as string);
      return [w.task_id as string, w.channel as string, value];
    });

    const tupleConfig: RunnableConfig = {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: cpId,
      },
    };

    const parentConfig: RunnableConfig | undefined = parentId
      ? {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: parentId,
          },
        }
      : undefined;

    return {
      config: tupleConfig,
      checkpoint,
      metadata,
      parentConfig,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? "") as string;
    if (!threadId) return;

    const limit = options?.limit ?? 100;
    const beforeId = options?.before?.configurable?.checkpoint_id as string | undefined;

    let query = `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                 FROM checkpoints WHERE thread_id = ? AND checkpoint_ns = ?`;
    const params: unknown[] = [threadId, checkpointNs];

    if (beforeId) {
      query += ` AND checkpoint_id < ?`;
      params.push(beforeId);
    }
    query += ` ORDER BY checkpoint_id DESC LIMIT ?`;
    params.push(limit);

    const stmt = this.db.prepare(query);
    const result = await stmt.bind(...params).all();

    for (const row of result.results || []) {
      const cpId = row.checkpoint_id as string;
      const parentId = row.parent_checkpoint_id as string | null;
      const type = (row.type as string) || "json";
      const cpData = row.checkpoint as string;
      const metaData = (row.metadata as string) || "{}";

      const checkpoint = this.serde.loadsTyped(type, cpData) as Checkpoint;
      const metadata = JSON.parse(metaData) as CheckpointMetadata;

      yield {
        config: {
          configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: cpId },
        },
        checkpoint,
        metadata,
        parentConfig: parentId
          ? { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentId } }
          : undefined,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? "") as string;
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    const [type, data] = this.serde.dumpsTyped(checkpoint);
    const metaStr = JSON.stringify(metadata);

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    await stmt
      .bind(threadId, checkpointNs, checkpoint.id, parentCheckpointId ?? null, type, data, metaStr)
      .run();

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.thread_id as string;
    const checkpointNs = (config.configurable?.checkpoint_ns ?? "") as string;
    const checkpointId = config.configurable?.checkpoint_id as string;

    if (!threadId || !checkpointId) return;

    const stmts = writes.map(([channel, value], idx) => {
      const [type, data] = this.serde.dumpsTyped(value);
      return this.db
        .prepare(
          `INSERT OR REPLACE INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(threadId, checkpointNs, checkpointId, taskId, idx, channel as string, type, data);
    });

    if (stmts.length > 0) {
      await this.db.batch(stmts);
    }
  }
}
