// Deliberately not using FlatCompat.extends("next/core-web-vitals", ...) here
// -- that routes through @eslint/eslintrc's legacy shareable-config bridge,
// which hits a known, currently-unresolved upstream bug (eslint/eslint#20237,
// vercel/next.js#85244) where reporting a config validation error crashes
// with "Converting circular structure to JSON" because eslint-plugin-react's
// config object self-references. eslint-config-next ships its own
// flat-config-native subpath exports built on the exact same underlying
// plugins (react, react-hooks, jsx-a11y, import, typescript-eslint) -- import
// those directly instead and skip the compat bridge entirely.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    // `.next*` rather than `.next`: a production build is run with NEXT_DIST_DIR=.next-prod (see
    // next.config.ts on why), and linting a build output fails on its own minified code.
    ignores: [".next*/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
