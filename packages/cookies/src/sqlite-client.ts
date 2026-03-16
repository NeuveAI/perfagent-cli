import path from "node:path";
import { Effect, Layer, ServiceMap } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import LibsqlDatabase from "libsql";
import { CookieDatabaseCopyError, CookieReadError } from "./errors.js";

const IS_BUN = "Bun" in globalThis;
const BUN_SQLITE_MODULE = "bun:sqlite";
const NODE_SQLITE_MODULE = "node:sqlite";

type SqliteRows = Array<Record<string, unknown>>;

const queryWithNodeSqlite = Effect.fn("SqliteClient.queryWithNodeSqlite")(function* (
  databasePath: string,
  sqlQuery: string,
  browser: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const { DatabaseSync } = await import(NODE_SQLITE_MODULE);
      const database = new DatabaseSync(databasePath, { readOnly: true, readBigInts: true });
      try {
        return database.prepare(sqlQuery).all() as SqliteRows;
      } finally {
        database.close();
      }
    },
    catch: (cause) => new CookieReadError({ browser, cause: String(cause) }),
  });
});

const queryWithLibsql = Effect.fn("SqliteClient.queryWithLibsql")(function* (
  databasePath: string,
  sqlQuery: string,
  browser: string,
) {
  return yield* Effect.try({
    try: () => {
      const database = new LibsqlDatabase(databasePath, { readonly: true });
      try {
        return database.prepare(sqlQuery).all() as SqliteRows;
      } finally {
        database.close();
      }
    },
    catch: (cause) => new CookieReadError({ browser, cause: String(cause) }),
  });
});

const queryWithBun = Effect.fn("SqliteClient.queryWithBun")(function* (
  databasePath: string,
  sqlQuery: string,
  browser: string,
) {
  return yield* Effect.tryPromise({
    try: async () => {
      const { Database } = await import(BUN_SQLITE_MODULE);
      const database = new Database(databasePath, { readonly: true });
      try {
        return database.query(sqlQuery).all() as SqliteRows;
      } finally {
        database.close();
      }
    },
    catch: (cause) => new CookieReadError({ browser, cause: String(cause) }),
  });
});

export class SqliteClient extends ServiceMap.Service<SqliteClient>()("@cookies/SqliteClient", {
  make: Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    const query = Effect.fn("SqliteClient.query")(function* (
      databasePath: string,
      sqlQuery: string,
      browser: string,
    ) {
      yield* Effect.annotateCurrentSpan({ browser, databasePath });
      if (IS_BUN) return yield* queryWithBun(databasePath, sqlQuery, browser);

      return yield* queryWithNodeSqlite(databasePath, sqlQuery, browser).pipe(
        Effect.catchTag("CookieReadError", () =>
          queryWithLibsql(databasePath, sqlQuery, browser),
        ),
      );
    });

    const copyToTemp = Effect.fn("SqliteClient.copyToTemp")(function* (
      databasePath: string,
      prefix: string,
      filename: string,
      browser: string,
    ) {
      const tempDir = yield* fileSystem.makeTempDirectory({ prefix });
      yield* Effect.addFinalizer(() =>
        fileSystem.remove(tempDir, { recursive: true }).pipe(Effect.catch(() => Effect.void)),
      );

      const tempDatabasePath = path.join(tempDir, filename);
      yield* fileSystem
        .copyFile(databasePath, tempDatabasePath)
        .pipe(
          Effect.catchTag("PlatformError", (cause) =>
            new CookieDatabaseCopyError({ browser, databasePath, cause: String(cause) }).asEffect(),
          ),
        );
      yield* fileSystem
        .copyFile(`${databasePath}-wal`, `${tempDatabasePath}-wal`)
        .pipe(Effect.catch(() => Effect.void));
      yield* fileSystem
        .copyFile(`${databasePath}-shm`, `${tempDatabasePath}-shm`)
        .pipe(Effect.catch(() => Effect.void));

      return { tempDir, tempDatabasePath };
    });

    return { query, copyToTemp } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(NodeServices.layer));
}
