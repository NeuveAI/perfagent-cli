import { useState } from "react";
import { useNavigate } from "react-router";
import { UserProfile, TIMEZONES } from "../data.ts";
import { Modal } from "../components/modal.tsx";
import { useToast } from "../components/toast.tsx";

interface SettingsPageProps {
  currentUser: UserProfile;
  setCurrentUser: React.Dispatch<React.SetStateAction<UserProfile>>;
}

interface SavedProfile {
  name: string;
  avatarUrl: string;
}

interface SavedOrg {
  name: string;
  timezone: string;
}

interface NotificationPreferences {
  weeklyDigest: boolean;
  securityAlerts: boolean;
  productUpdates: boolean;
}

const deriveOrgSlug = (orgName: string): string =>
  orgName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

const NotificationToggle = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) => (
  <div className="flex items-center justify-between py-4">
    <span className="text-sm font-medium text-gray-900">{label}</span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? "bg-blue-600" : "bg-gray-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  </div>
);

export const SettingsPage = ({ currentUser, setCurrentUser }: SettingsPageProps) => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<
    "profile" | "notifications" | "organization" | "danger"
  >("profile");

  const [profileName, setProfileName] = useState(currentUser.name);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(currentUser.avatarUrl);
  const [savedProfile, setSavedProfile] = useState<SavedProfile>({
    name: currentUser.name,
    avatarUrl: currentUser.avatarUrl,
  });
  const isProfileDirty =
    profileName !== savedProfile.name || profileAvatarUrl !== savedProfile.avatarUrl;

  const [notifications, setNotifications] = useState<NotificationPreferences>({
    weeklyDigest: true,
    securityAlerts: true,
    productUpdates: false,
  });

  const [orgName, setOrgName] = useState(currentUser.organization);
  const [orgTimezone, setOrgTimezone] = useState("America/New_York");
  const [savedOrg, setSavedOrg] = useState<SavedOrg>({
    name: currentUser.organization,
    timezone: "America/New_York",
  });
  const [isOrgDirty, setIsOrgDirty] = useState(false);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");

  const handleDiscardProfile = () => {
    setProfileName(savedProfile.name);
    setProfileAvatarUrl(savedProfile.avatarUrl);
  };

  const handleSaveProfile = () => {
    const nextSaved = { name: profileName, avatarUrl: profileAvatarUrl };
    setSavedProfile(nextSaved);
    setCurrentUser((prev) => ({
      ...prev,
      name: nextSaved.name,
      avatarUrl: nextSaved.avatarUrl,
    }));
    showToast("Profile updated");
  };

  const handleNotificationToggle = (key: keyof NotificationPreferences) => {
    setNotifications((prev) => ({ ...prev, [key]: !prev[key] }));
    showToast("Notification preference updated");
  };

  const handleSaveOrg = () => {
    const nextSaved = { name: orgName, timezone: orgTimezone };
    setSavedOrg(nextSaved);
    setIsOrgDirty(false);
    showToast("Organization settings updated");
  };

  const handleDeleteConfirm = () => {
    setDeleteModalOpen(false);
    setConfirmInput("");
    showToast("Organization deleted");
    navigate("/dashboard");
  };

  const tabs: { id: "profile" | "notifications" | "organization" | "danger"; label: string }[] = [
    { id: "profile", label: "Profile" },
    { id: "notifications", label: "Notifications" },
    { id: "organization", label: "Organization" },
    { id: "danger", label: "Danger Zone" },
  ];

  return (
    <div className="space-y-8 p-8">
      <h1 className="text-3xl font-semibold text-gray-900">Settings</h1>

      <div className="flex gap-8 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="max-w-md space-y-6">
          <div>
            <label htmlFor="display-name" className="mb-1 block text-sm font-medium text-gray-700">
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="email"
              type="text"
              value={currentUser.email}
              disabled
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-500"
            />
          </div>
          <div>
            <label htmlFor="avatar-url" className="mb-1 block text-sm font-medium text-gray-700">
              Avatar URL
            </label>
            <input
              id="avatar-url"
              type="text"
              value={profileAvatarUrl}
              onChange={(event) => setProfileAvatarUrl(event.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDiscardProfile}
              disabled={!isProfileDirty}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard Changes
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={!isProfileDirty}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Changes
            </button>
          </div>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="max-w-md">
          <NotificationToggle
            label="Weekly Digest"
            checked={notifications.weeklyDigest}
            onChange={() => handleNotificationToggle("weeklyDigest")}
          />
          <NotificationToggle
            label="Security Alerts"
            checked={notifications.securityAlerts}
            onChange={() => handleNotificationToggle("securityAlerts")}
          />
          <NotificationToggle
            label="Product Updates"
            checked={notifications.productUpdates}
            onChange={() => handleNotificationToggle("productUpdates")}
          />
        </div>
      )}

      {activeTab === "organization" && (
        <div className="max-w-md space-y-6">
          <div>
            <label htmlFor="org-name" className="mb-1 block text-sm font-medium text-gray-700">
              Organization Name
            </label>
            <input
              id="org-name"
              type="text"
              value={orgName}
              onChange={(event) => {
                setOrgName(event.target.value);
                setIsOrgDirty(true);
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Organization Slug
            </label>
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-600">
              {deriveOrgSlug(orgName) || "(empty)"}
            </p>
          </div>
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm font-medium text-gray-700">
              Timezone
            </label>
            <select
              id="timezone"
              value={orgTimezone}
              onChange={(event) => {
                setOrgTimezone(event.target.value);
                setIsOrgDirty(true);
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {TIMEZONES.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleSaveOrg}
            disabled={!isOrgDirty}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      {activeTab === "danger" && (
        <div className="max-w-md rounded-lg border-2 border-red-200 bg-red-50/50 p-6">
          <h2 className="mb-2 text-lg font-semibold text-red-800">Delete Organization</h2>
          <p className="mb-4 text-sm text-red-700">
            This will permanently delete your organization and all associated data.
          </p>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete Organization
          </button>
        </div>
      )}

      <Modal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setConfirmInput("");
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Organization"
        confirmLabel="Delete Forever"
        confirmDisabled={confirmInput !== currentUser.organization}
        destructive
      >
        <p className="mb-4 text-sm text-gray-600">
          Type <strong>{currentUser.organization}</strong> to confirm.
        </p>
        <input
          type="text"
          value={confirmInput}
          onChange={(event) => setConfirmInput(event.target.value)}
          placeholder="Organization name"
          className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
      </Modal>
    </div>
  );
};
