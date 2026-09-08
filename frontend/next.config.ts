import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// A version stamp appended to every public asset URL (see lib/api.ts `apiAssetUrl`).
//
// The backend serves the item icons and digit sprites with `Cache-Control: max-age=86400` and no
// ETag, and their URLs never change (`/digit-icons/0.png`). So when one of those generated assets
// is regenerated (the count digits were recoloured once and came back white for a day), the browser
// keeps serving the old copy for up to 24h. Stamping the URL with a value that changes each build
// gives the new asset a new URL, so it cannot be masked, while the long cache still applies.
//
// Prefer an explicit deploy value; fall back to the commit, then a build timestamp. Evaluated once
// at config load (a build, or dev-server start).
const assetVersion =
  process.env.NEXT_PUBLIC_ASSET_VERSION ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      return String(Date.now());
    }
  })();

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // `next build` writes to the same directory `next dev` serves from, so running a
  // production build while the dev server is up POISONS it: the dev server keeps
  // serving the pre-build pages and never recompiles, and its compile log stays
  // silent, because nothing recompiled. It looks exactly like "my changes did
  // nothing", and it cost several rounds of confusion before we spotted it.
  //
  // NEXT_DIST_DIR sends a build somewhere else:
  //     NEXT_DIST_DIR=.next-prod npx next build
  distDir: process.env.NEXT_DIST_DIR || ".next",

  env: { NEXT_PUBLIC_ASSET_VERSION: assetVersion },

  // Local preview only, and off unless PREVIEW_API_ORIGIN is set. The devcontainer forwards
  // 3000/8080/5432 and ignores everything else, so a second backend run beside the dev stack
  // (PORT=8081) is not reachable from the host browser. Proxying it through the dev server's own
  // origin means only the frontend port has to be forwarded, and it makes the calls same-origin,
  // so CORS stops mattering for the preview too.
  async rewrites() {
    const previewApi = process.env.PREVIEW_API_ORIGIN;
    if (!previewApi) return [];
    return [{ source: "/preview-api/:path*", destination: `${previewApi}/:path*` }];
  },

  // The two brand faces are 468kb together, and Next serves everything in public/ as
  // `max-age=0, must-revalidate`, so a fresh browser session spends a conditional round trip on
  // each before any text can be drawn in the right font. The hashed bundles beside them already
  // get a year and `immutable`; these had nothing.
  //
  // Their names carry no content hash, so this cache is only safe while the bytes behind a name
  // never change: REPLACE A FACE UNDER A NEW FILENAME, updating the @font-face src in globals.css,
  // rather than overwriting it in place. Overwriting serves the old face for up to a year, which is
  // the same trap NEXT_PUBLIC_ASSET_VERSION exists to keep off the icons.
  async headers() {
    return [
      {
        source: "/fonts/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },

  // The section moved from /characters to /inventory. Keep old bookmarks and in-flight
  // sessions working with a permanent redirect. The API routes (/api/characters) are the
  // data resource and are unaffected.

  // The Drop Log came out from under Party View when it started holding drops from bosses that
  // have no party. Permanent, since the old path is nobody's page any more.
  async redirects() {
    return [{ source: "/bosses/parties/drops", destination: "/bosses/drops", permanent: true }];
  },
};

export default nextConfig;
