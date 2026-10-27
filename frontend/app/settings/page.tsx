"use client";

import { SectionNav } from "@/components/section-nav";
import { SettingsHead } from "@/components/settings-head";
import { WorldToggle } from "@/components/world-toggle";

export default function SettingsPage() {
  return (
    <main className="page">
      <SettingsHead current="general" />
      <SectionNav sections={[{ id: "world", label: "World" }]}>
        <section id="world" className="character-group social-section">
          <h2 className="character-world">
            <a href="#world">World</a>
          </h2>
          <WorldToggle />
        </section>
      </SectionNav>
    </main>
  );
}
