# Effect Guidelines

Effect v4 patterns for this package.

## Services — Use `ServiceMap.Service`

Never use `Effect.Service` or `Context.Tag`. Use `ServiceMap.Service` with `make:` property and explicit `static layer`.

```ts
import { Effect, Layer, ServiceMap } from "effect";

export class Cookies extends ServiceMap.Service<Cookies>()("@cookies/Cookies", {
  make: Effect.gen(function* () {
    const cdpClient = yield* CdpClient;

    const extract = Effect.fn("Cookies.extract")(function* (options: ExtractOptions) {
      yield* Effect.annotateCurrentSpan({ url: options.url });
      // ...
      return cookies;
    });

    return { extract } as const;
  }),
}) {
  static layer = Layer.effect(this)(this.make).pipe(Layer.provide(CdpClient.layer));
}
```

Key differences from `Effect.Service`:

- `make:` not `effect:`
- No `dependencies:` array — use `Layer.provide()` chaining on `static layer`
- No `accessors: true`
- `Layer.effect(this)(this.make)` for the layer

## Errors — Use `Schema.ErrorClass`

Use `Schema.ErrorClass` with explicit `_tag: Schema.tag(...)`. Define `message` as a class field derived from data, never as a schema field.

```ts
import { Schema } from "effect";

export class CookieDatabaseNotFoundError extends Schema.ErrorClass<CookieDatabaseNotFoundError>(
  "CookieDatabaseNotFoundError",
)({
  _tag: Schema.tag("CookieDatabaseNotFoundError"),
  browser: Schema.String,
}) {
  message = `Cookie database not found for ${this.browser}`;
}
```

Use `.asEffect()` to fail:

```ts
return yield * new CookieDatabaseNotFoundError({ browser }).asEffect();
```

## Error Handling

Use `catchTag` / `catchTags` for specific errors. Never `catchAll` or `mapError`.

Infrastructure errors become defects:

```ts
Effect.catchTags({ SqlError: Effect.die, SchemaError: Effect.die });
```

Domain errors get specific handling:

```ts
Effect.catchTag("NoSuchElementError", () =>
  new CookieDatabaseNotFoundError({ browser }).asEffect(),
);
```

## Never Swallow Errors

Banned patterns:

```ts
Effect.orElseSucceed(() => undefined);
Effect.catchAll(() => Effect.succeed(undefined));
Effect.option;
Effect.ignore();
```

Allowed — recover from specific, expected errors:

```ts
Effect.catchTag("CookieDatabaseNotFoundError", () => Effect.succeed([]));
```

## Functions — Use `Effect.fn`

Every effectful function uses `Effect.fn` with a descriptive span name:

```ts
const extractChromiumCookies = Effect.fn("extractChromiumCookies")(function* (
  browser: ChromiumBrowser,
  hosts: string[],
) {
  yield* Effect.annotateCurrentSpan({ browser });
  // ...
});
```

## Never Explicitly Type Return Types

Let TypeScript infer. Never annotate `: Effect.Effect<...>` on functions.

```ts
// BAD
const get = (id: string): Effect.Effect<Cookie[], CookieReadError> => ...

// GOOD
const get = (id: string) => Effect.gen(function* () { ... });
```

## Never Use Null

Use `Option` from Effect or `undefined`. Never `null`.

```ts
// BAD
return null;

// GOOD
return Option.none();
```

## Prefer `Effect.forEach` Over `Effect.all`

```ts
// BAD
yield * Effect.all(browsers.map((browser) => extractBrowser(browser)));

// GOOD
yield *
  Effect.forEach(browsers, (browser) => extractBrowser(browser), {
    concurrency: "unbounded",
  });
```

## Conditional Failures — Use `return yield*`

Always use `return yield*` for conditional failures so TypeScript narrows correctly:

```ts
if (!databasePath) {
  return yield * new CookieDatabaseNotFoundError({ browser }).asEffect();
}
```

## Structured Logging

Use `Effect.logInfo`, `Effect.logWarning`, `Effect.logDebug` with structured data:

```ts
yield *
  Effect.logInfo("Chromium cookies extracted", {
    browser,
    count: cookies.length,
  });
```

## Avoid `try` / `catch`

Use `Effect.try` for sync and `Effect.tryPromise` for async:

```ts
const rows =
  yield *
  Effect.tryPromise({
    try: () => querySqlite(dbPath, sql),
    catch: (cause) => new CookieReadError({ browser, cause: String(cause) }),
  });
```

## Pure Functions Stay Pure

Functions with no I/O and no failure modes do not need Effect wrapping.
