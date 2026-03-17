/**
 * @deprecated ARCHIVED / DEAD CODE
 * Do not import, pattern-match on, or reference this code in new work.
 * Kept only as reference for browser SQLite decryption and cookie extraction logic.
 */

export const expandHostCandidates = (host: string): string[] => {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return [host];

  const candidates = new Set<string>();
  candidates.add(host);
  for (let index = 1; index <= parts.length - 2; index += 1) {
    const candidate = parts.slice(index).join(".");
    if (candidate) candidates.add(candidate);
  }
  return Array.from(candidates);
};

export const sqlLiteral = (value: string): string => {
  const escaped = value.replaceAll("'", "''");
  return `'${escaped}'`;
};

export const buildHostWhereClause = (hosts: string[], column: string): string => {
  const clauses: string[] = [];
  for (const host of hosts) {
    for (const candidate of expandHostCandidates(host)) {
      const escaped = sqlLiteral(candidate);
      const escapedDot = sqlLiteral(`.${candidate}`);
      const escapedLike = sqlLiteral(`%.${candidate}`);
      clauses.push(`${column} = ${escaped}`);
      clauses.push(`${column} = ${escapedDot}`);
      clauses.push(`${column} LIKE ${escapedLike}`);
    }
  }
  return clauses.length ? clauses.join(" OR ") : "1=0";
};

export const sqliteBool = (value: unknown): boolean => value === 1 || value === 1n;

export const stringField = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
