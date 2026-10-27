import Link from "next/link";

export type SettingsTab = "general";

const TABS: { key: SettingsTab; href: string; label: string }[] = [
  { key: "general", href: "/settings", label: "General" },
];

/** Settings' title and its pages, drawn as Social's are. */
export function SettingsHead({ current }: { current: SettingsTab }) {
  return (
    <>
      <h1 className="page-title">Settings</h1>
      <nav className="basis-row social-tabs" aria-label="Settings">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={tab.key === current ? "basis-tab active" : "basis-tab"}
            aria-current={tab.key === current ? "page" : undefined}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
