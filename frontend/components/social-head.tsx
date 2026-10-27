import Link from "next/link";

export type SocialTab = "friends" | "people";

const TABS: { key: SocialTab; href: string; label: string }[] = [
  { key: "friends", href: "/social", label: "Friends" },
  { key: "people", href: "/social/people", label: "People" },
];

/** Social's title and its pages, drawn as the Drop Log's section chips. */
export function SocialHead({ current }: { current: SocialTab }) {
  return (
    <>
      <h1 className="page-title">Social</h1>
      <nav className="basis-row social-tabs" aria-label="Social">
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
