import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isBuild = process.argv.includes("build");

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5000;

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(async () => {
  const devPlugins =
    !isBuild && process.env.NODE_ENV !== "production" && process.env.REPL_ID
      ? [
          await import("@replit/vite-plugin-runtime-error-modal").then((m) =>
            m.default()
          ),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, "..") })
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner()
          ),
        ]
      : [];

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), ...devPlugins],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // Target modern browsers — smaller output (no legacy transforms for arrow fns, etc.)
      target: "esnext",
      // Minify with esbuild (default, fastest). Keeps bundles small without needing terser.
      minify: "esbuild",
      // Inline assets smaller than 4 KB to save round trips
      assetsInlineLimit: 4096,
      rollupOptions: {
        output: {
          // Fine-grained chunk splitting:
          //   • heavy media/player deps only load when the user enters a room
          //   • UI / icon deps load once then stay cached across navigation
          manualChunks: (id) => {
            // Player-specific heavy deps — defer until room page loads
            if (id.includes("node_modules/hls.js"))          return "chunk-hls";
            if (id.includes("node_modules/dashjs"))           return "chunk-dash";
            if (id.includes("node_modules/react-player"))     return "chunk-player";
            // Animation — only used in a few places
            if (id.includes("node_modules/framer-motion"))    return "chunk-framer";
            // Emoji picker — large, rarely used
            if (
              id.includes("node_modules/emoji-picker-react") ||
              id.includes("node_modules/emoji-")
            )                                                  return "chunk-emoji";
            // Socket.io client
            if (id.includes("node_modules/socket.io"))        return "chunk-socket";
            // Everything else from node_modules (including React) stays in vendor
            // NOTE: React must NOT be split separately — doing so breaks initialization order
            if (id.includes("node_modules/"))                 return "chunk-vendor";
          },
        },
      },
      chunkSizeWarningLimit: 1200,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://localhost:8080",
          changeOrigin: true,
          ws: true,
        },
      },
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
