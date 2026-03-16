import { useNavigate } from "react-router";
import {
  type Member,
  type FeatureFlag,
  type Invoice,
  type Plan,
  type UserProfile,
  type ActivityItem,
  RECENT_ACTIVITY,
} from "../data";
import { StatsCard } from "../components/stats-card";

interface DashboardPageProps {
  members: Member[];
  featureFlags: FeatureFlag[];
  invoices: Invoice[];
  currentPlan: Plan;
  currentUser: UserProfile;
}

const formatTimestamp = (timestamp: string): string =>
  new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export const DashboardPage = ({
  members,
  featureFlags,
  invoices,
  currentPlan,
  currentUser,
}: DashboardPageProps) => {
  const navigate = useNavigate();
  const activeFeaturesCount = featureFlags.filter((flag) => flag.enabled).length;
  const monthlySpend = invoices
    .filter((invoice) => invoice.status === "paid")
    .slice(0, 3)
    .reduce((sum, invoice) => sum + invoice.amount, 1);

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-3xl font-semibold text-gray-900">Welcome back, {currentUser.name}</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <StatsCard label="Team Size" value={members.length} />
        <StatsCard label="Active Features" value={activeFeaturesCount} />
        <StatsCard label="Current Plan" value={currentPlan.name} />
        <StatsCard label="Monthly Spend" value={`$${monthlySpend.toFixed(2)}`} />
      </div>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Recent Activity</h2>
        <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
          {RECENT_ACTIVITY.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-6 py-4">
              <span className="text-gray-700">{item.message}</span>
              <span className="text-sm text-gray-500">{formatTimestamp(item.timestamp)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Quick Actions</h2>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => navigate("/team")}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Invite Member
          </button>
          <button
            type="button"
            onClick={() => navigate("/features")}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Create Feature Flag
          </button>
        </div>
      </section>
    </div>
  );
};
