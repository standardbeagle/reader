import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://dev.standardbeagle.com",
  base: "/reader",
  integrations: [
    sitemap(),
    starlight({
      title: "reader",
      description:
        "A Google Reader clone for the agent era: RSS/Atom reading as an Electron desktop app or a hosted web service from one TypeScript codebase.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/standardbeagle/reader",
        },
      ],
      sidebar: [
        { label: "Quick start", slug: "getting-started" },
        {
          label: "User guide",
          items: [
            { label: "Reading articles", slug: "user/reading" },
            { label: "Keyboard shortcuts", slug: "user/keyboard" },
            { label: "Saved lists", slug: "user/lists" },
            { label: "Snooze", slug: "user/snooze" },
            { label: "Ingestors", slug: "user/ingestors" },
          ],
        },
        {
          label: "Development",
          items: [
            { label: "Architecture", slug: "reference/architecture" },
            { label: "HTTP API", slug: "reference/api" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Hosting", slug: "hosting" },
            { label: "Configuration", slug: "configuration" },
          ],
        },
        { label: "Changelog", slug: "changelog" },
      ],
    }),
  ],
});
