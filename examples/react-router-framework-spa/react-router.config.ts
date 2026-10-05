import type { Config } from "@react-router/dev/config";

// No server at runtime: the build prerenders index.html from the root route.
export default { ssr: false } satisfies Config;
