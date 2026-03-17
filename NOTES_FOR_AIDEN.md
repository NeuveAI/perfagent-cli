```ts

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

```

not needed, we can use `Predicate.isObject`

2. avoid broad catch statements, prefer narrow catch statements

```ts
const localStatePath = path.join(userDataDir, "Local State");
const content = yield* fileSystem
  .readFileString(localStatePath)
  .pipe(Effect.catch(() => Effect.succeed("")));
if (!content) return EMPTY_PROFILE_METADATA;
```
this catches even if we have permission errors or whatever.  we only wanna catch it if the file doesn't exist

instead, do:

```ts
const foo = yield* fileSystem
  .readFileString(localStatePath)
  .pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(""))
  );
```

(Effect.catchReason is the new meta for these kind of broad errors that contain different possible suberrors (PlatformError has { reason: <union of errors> }))

2.1 **aside** i would not return `EMPTY_PROFILE_METADATA`, instead i would model it as an error `ProfileMetadataNotFound`, then consumers can decide to catchTag it or not. generally try to ONLY model the happy path on the success channel of an effect, at first it might seem dumb but if you do that you will see that your code starts shrinking, and the logic becomes more focused.

3. Prefer schemas over fragile property checks

```ts
const localState = yield* Effect.try({
  try: () => JSON.parse(content),
  catch: () => undefined,
});
if (!isObjectRecord(localState)) return EMPTY_PROFILE_METADATA;

const profileState = localState["profile"];
if (!isObjectRecord(profileState)) return EMPTY_PROFILE_METADATA;

const infoCache = profileState["info_cache"];
const lastUsedProfileName =
  typeof profileState["last_used"] === "string"
    ? profileState["last_used"]
    : undefined;
```

this whole just becomes 

```ts
const profiles = yield* fileSystem
  .readFileString(localStatePath)
  .pipe(
    Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(ProfileSchema)))
  )

// @note(rasmus): im not sure what's the shape of profiles yet but im assuming that this profile contains all the needed stuff, so you can just return here
return profiles
```

3. `BrowserDetector` service should not have code for all platforms inside the main `make`, instead the philosophy is that you have separate layers per platform, eg `layerWindows`, `layerMac`, `layerLinux`, and those layers contain the platform-specific logic. 

this makes it so that you can focus on the platform-agnostic code, then just write whatever is left in the platform-specific layers (which usually is a small amount of glue-code)

Then when you construct your layers, you just match on `platform` to check which one to provide.

4. sorting usually becomes more easy to understand and composable using `effect/Order`, eg:

```ts
profiles.sort((left, right) => {
          const leftIsLastUsed = left.profileName === lastUsedProfileName;
          const rightIsLastUsed = right.profileName === lastUsedProfileName;
          if (leftIsLastUsed !== rightIsLastUsed)
            return leftIsLastUsed ? -1 : 1;
          return naturalCompare(left.profileName, right.profileName);
        });
```

so we just wanna sort by 1) last used first then alphabetically

this becomes

```ts
const byLastUsed = Order.mapInput(
  Order.Boolean,
  (p: BrowserProfile) => p.profileName === lastUsedProfileName
);
const byProfileName = Order.mapInput(
  Order.make(
    (a: string, b: string) => naturalCompare(a, b) as -1 | 0 | 1
  ),
  (p: BrowserProfile) => p.profileName
);
const byLastUsedThenName = Order.combine(byLastUsed, byProfileName);
profiles.sort(byLastUsedThenName);
```

so this allows us to easily compose any amount of of sorting criteria, and they compose perfectly, eg. when byLastUsed returns a tie -> then it checks byProfileName

5. use `fs.makeTempDirectoryScoped`

```ts
  const tempUserDataDirPath = yield* fileSystem.makeTempDirectory({ prefix: "cookies-cdp-" });
      yield* Effect.addFinalizer(() =>
        fileSystem
          .remove(tempUserDataDirPath, { recursive: true })
          .pipe(Effect.catch(() => Effect.void)),
      );
```

you wanna make a temp directory, and remove it once were done with it, you can just use `makeTempDirectoryScoped`, it cleans up the folder for you once the scope is closed (once you do Effect.scoped) so in this at the end of the function

6.

```ts
Effect.retry(
  Schedule.spaced("1 second").pipe(Schedule.compose(Schedule.recurs(CDP_RETRY_COUNT))),
),
```

imo this more readable

```ts
Effect.retry({
  times: CPD_RETRY_COUNT,
  schedule: Schedule.spaced("1 second")
}),
```

7. recursive copy fn `copyDirectoryRecursive` not needed
just use `fs.copy()`

8. `return yield* new UnsupportedPlatformError({ platform: platform() }).asEffect();` -> `.asEffect()` is not needed

9. avoid recovering from UNEXPECTED ("UNRECOVERABLE" / "DEFECT") errors 
```ts
pipe(
Effect.catchTags({
  CookieDatabaseNotFoundError: () => Effect.succeed([] as Cookie[]),
  CookieDatabaseCopyError: () => Effect.succeed([] as Cookie[]),
  CookieDecryptionKeyError: () => Effect.succeed([] as Cookie[]),
  CookieReadError: () => Effect.succeed([] as Cookie[]),
  UnsupportedPlatformError: () => Effect.succeed([] as Cookie[]),
  BinaryParseError: () => Effect.succeed([] as Cookie[]),
}),
```

Most of these signal deep UNRECOVERABLE errors, eg. if BinaryParseError is thrown, means we have implemented binary parsing incorrectly. this is a bug in our software, and as such this shouldn't be recovered from. if we recover from unrecoverable errors, we hide these bugs, and in turn create new bugs where the users will be like "it didn't copy cookies correctly", when in reality the BinaryParseError happened, but we recovered from it. 

for unrecoverable errros (BinaryParseError, UnsupportedPlatformErrro, CoookieDatabaseNotFoundError, probably CookieReadError and CookieDecryptionKeyError too), we should just do Effect.die.

the error channel should be reserved for recoverable errors, for example, `BrowserNotFoundError`, this signals that the user tried to copy cookies from a browser they don't have installed, but its expected behavior that it errors

10. constrain the number of schemas (or types), and stick to those schemas everywhere

previously there were different models like `BrowserProfile` and `BrowserInfo`, `ProfileMetadata` and `CdpRawCookie` instead try to just consolidate as much as possible. 

now there is simply `Browser` and `Cookie`, becomes much simpler to reason about, you always know that a function should return a `Browser` or `Cookie`.

11. layers should be used for platform-specific logic

example from sqlite-client.ts:

```ts


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
```

this does a lot of code duplication. the logic is essentially the same for all platforms.

instead, use separate Layers that each provide ONLY the platform-specific requirements

```ts
export class SqliteEngine extends ServiceMap.Service<
  SqliteEngine,
  {
    readonly open: (
      databasePath: string
    ) => Effect.Effect<SqliteDatabase, CookieReadError, Scope.Scope>;
  }
>()("@cookies/SqliteEngine") {
  static layerBun = Layer.succeed(this, {
    open: (databasePath: string) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const { Database } = await import(BUN_SQLITE_MODULE);
            return new Database(databasePath, {
              readonly: true,
            }) as SqliteDatabase;
          },
          catch: (cause) =>
            new CookieReadError({ browser: "unknown", cause: String(cause) }),
        }),
        (database) => Effect.sync(() => database.close())
      ),
  });

  static layerNodeJs = Layer.succeed(this, {
    open: (databasePath: string) =>
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const { Database } = await import(NODE_SQLITE_MODULE);
            return new Database(databasePath, {
              readOnly: true,
              readBigInts: true,
            }) as unknown as SqliteDatabase;
          },
          catch: (cause) =>
            new CookieReadError({ browser: "unknown", cause: String(cause) }),
        }),
        (database) => Effect.sync(() => database.close())
      ),
  });

  static layerLibSql = Layer.succeed(this, {
    open: (databasePath: string) =>
      Effect.acquireRelease(
        Effect.try({
          try: () =>
            new LibsqlDatabase(databasePath, {
              readonly: true,
            }) as unknown as SqliteDatabase,
          catch: (cause) =>
            new CookieReadError({ browser: "unknown", cause: String(cause) }),
        }),
        (database) => Effect.sync(() => database.close())
      ),
  });
}
```

13. avoid Effect.catch(...)

almost always better to use Effect.catchTag("SpecificError", () => ...)

12. single responsibility stuff (more philosophical and code organization stuff)

separated all the browsers into separate provider services, which simply register themselves with the Browsers service using  `register(...)`

also each of these rely on platform-specific config services, which are provided during runtime. this makes separation simpler, where the logic is shared across platforms, but the platform-specific details are injected via the config services.
