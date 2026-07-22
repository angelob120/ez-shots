import SettingsTabs from "./SettingsTabs";

// Branding and Payments keep their own URLs — this is a route group, so it adds
// the shared tab strip without moving either page.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
