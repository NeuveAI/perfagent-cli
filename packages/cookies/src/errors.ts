import { Schema } from "effect";

export class CookieDatabaseNotFoundError extends Schema.ErrorClass<CookieDatabaseNotFoundError>(
  "CookieDatabaseNotFoundError",
)({
  _tag: Schema.tag("CookieDatabaseNotFoundError"),
  browser: Schema.String,
}) {
  message = `Cookie database not found for ${this.browser}`;
}

export class CookieDatabaseCopyError extends Schema.ErrorClass<CookieDatabaseCopyError>(
  "CookieDatabaseCopyError",
)({
  _tag: Schema.tag("CookieDatabaseCopyError"),
  browser: Schema.String,
  databasePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to copy cookie database for ${this.browser}: ${this.cause}`;
}

export class CookieDecryptionKeyError extends Schema.ErrorClass<CookieDecryptionKeyError>(
  "CookieDecryptionKeyError",
)({
  _tag: Schema.tag("CookieDecryptionKeyError"),
  browser: Schema.String,
  platform: Schema.String,
}) {
  message = `Decryption key not found for ${this.browser} on ${this.platform}`;
}

export class CookieReadError extends Schema.ErrorClass<CookieReadError>("CookieReadError")({
  _tag: Schema.tag("CookieReadError"),
  browser: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to read cookies for ${this.browser}: ${this.cause}`;
}

export class BinaryParseError extends Schema.ErrorClass<BinaryParseError>("BinaryParseError")({
  _tag: Schema.tag("BinaryParseError"),
  filePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to parse binary cookies at ${this.filePath}: ${this.cause}`;
}

export class CdpConnectionError extends Schema.ErrorClass<CdpConnectionError>("CdpConnectionError")(
  {
    _tag: Schema.tag("CdpConnectionError"),
    port: Schema.Number,
    cause: Schema.String,
  },
) {
  message = `CDP connection failed on port ${this.port}: ${this.cause}`;
}

export class BrowserSpawnError extends Schema.ErrorClass<BrowserSpawnError>("BrowserSpawnError")({
  _tag: Schema.tag("BrowserSpawnError"),
  executablePath: Schema.String,
  cause: Schema.String,
}) {
  message = `Failed to spawn browser at ${this.executablePath}: ${this.cause}`;
}

export class UnsupportedPlatformError extends Schema.ErrorClass<UnsupportedPlatformError>(
  "UnsupportedPlatformError",
)({
  _tag: Schema.tag("UnsupportedPlatformError"),
  platform: Schema.String,
}) {
  message = `Unsupported platform: ${this.platform}`;
}

export class UnsupportedBrowserError extends Schema.ErrorClass<UnsupportedBrowserError>(
  "UnsupportedBrowserError",
)({
  _tag: Schema.tag("UnsupportedBrowserError"),
  browser: Schema.String,
}) {
  message = `Unsupported browser: ${this.browser}`;
}
