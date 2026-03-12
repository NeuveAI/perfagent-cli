interface RemoteBranch {
  name: string;
  author: string;
  prNumber: number | null;
  prStatus: "open" | "draft" | "merged" | null;
}

const PREFIXES = ["feature", "fix", "chore", "refactor", "hotfix", "release", "deps", "experiment"];

const DESCRIPTORS = [
  "oauth-provider",
  "billing-webhook",
  "admin-dashboard",
  "graphql-schema",
  "cdn-migration",
  "k8s-deployment",
  "sentry-integration",
  "redis-cache",
  "email-templates",
  "worker-queue",
  "audit-logging",
  "i18n-support",
  "ssr-hydration",
  "db-sharding",
  "analytics-pipeline",
  "mobile-responsive",
  "docker-compose",
  "rbac-permissions",
  "rate-limiting",
  "test-coverage",
];

const AUTHORS = [
  "alice",
  "bob",
  "carol",
  "dan",
  "eve",
  "frank",
  "grace",
  "heidi",
  "ivan",
  "judy",
];

const PR_STATUSES: ("open" | "draft" | "merged")[] = ["open", "draft", "merged"];

const pickRandom = <T>(array: readonly T[]): T => array[Math.floor(Math.random() * array.length)];

const GUARANTEED_STATUSES: (typeof PR_STATUSES[number] | null)[] = [
  "open",
  "open",
  "open",
  "draft",
  "draft",
  "merged",
  "merged",
  null,
  null,
];

export const generateRemoteBranches = (count: number): RemoteBranch[] =>
  Array.from({ length: count }, (_, index) => {
    const guaranteedStatus = index < GUARANTEED_STATUSES.length ? GUARANTEED_STATUSES[index] : null;
    const hasPr = guaranteedStatus !== null || (index >= GUARANTEED_STATUSES.length && Math.random() > 0.3);
    const prStatus = guaranteedStatus ?? (hasPr ? pickRandom(PR_STATUSES) : null);
    return {
      name: `${pickRandom(PREFIXES)}/${pickRandom(DESCRIPTORS)}`,
      author: pickRandom(AUTHORS),
      prNumber: hasPr ? Math.floor(Math.random() * 500) + 1 : null,
      prStatus,
    };
  });

export type { RemoteBranch };
