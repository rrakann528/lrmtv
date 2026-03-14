import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isBuild = process.argv.includes("build");

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

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
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules/framer-motion")) return "framer";
            if (
              id.includes("node_modules/emoji-picker-react") ||
              id.includes("node_modules/emoji-")
            )
              return "emoji";
            if (id.includes("node_modules/hls.js")) return "hls";
            if (id.includes("node_modules/socket.io")) return "socket";
            if (id.includes("node_modules/")) return "vendor";
          },
        },
      },
      chunkSizeWarningLimit: 1000,
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
