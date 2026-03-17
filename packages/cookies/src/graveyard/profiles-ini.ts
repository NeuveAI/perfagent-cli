/**
 * @deprecated ARCHIVED / DEAD CODE
 * Do not import, pattern-match on, or reference this code in new work.
 * Kept only as reference for browser SQLite decryption and cookie extraction logic.
 */

import { parse } from "ini";
import { Schema } from "effect";

const FirefoxProfileSection = Schema.Struct({
  Name: Schema.String,
  Path: Schema.String,
  IsRelative: Schema.optional(Schema.String),
});

export interface FirefoxProfile {
  name: string;
  path: string;
  isRelative: boolean;
}

export const parseProfilesIni = (content: string): FirefoxProfile[] => {
  const parsed = parse(content);
  const profiles: FirefoxProfile[] = [];

  for (const [sectionName, section] of Object.entries(parsed)) {
    if (!/^Profile\d+$/.test(sectionName)) continue;

    const decoded = Schema.decodeUnknownOption(FirefoxProfileSection)(section);
    if (decoded._tag === "None") continue;

    profiles.push({
      name: decoded.value.Name,
      path: decoded.value.Path,
      isRelative: decoded.value.IsRelative !== "0",
    });
  }

  return profiles;
};

export const naturalCompare = (left: string, right: string): number =>
  left.localeCompare(right, undefined, { numeric: true });
