import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// `.env` holds deploy credentials only (see .env.example). Without this, the
// Cloudflare plugin would also load it as Worker dev vars and copy the values
// into dist/gamenight/.dev.vars on every build.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV ??= "false";

export default defineConfig({
  plugins: [react(), cloudflare()],
});
