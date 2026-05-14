import { resolve } from "node:path";
import { existsSync, readdirSync, rmSync } from "node:fs";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function cleanGeneratedZendeskAssets() {
  const outputDir = resolve(__dirname, "../assets");

  return {
    name: "clean-generated-zendesk-assets",
    apply: "build",
    buildStart() {
      if (!existsSync(outputDir)) return;
      for (const filename of readdirSync(outputDir)) {
        if (filename === "iframe.html" || /^index-[\w-]+\.(js|css)$/.test(filename)) {
          rmSync(resolve(outputDir, filename), { force: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [cleanGeneratedZendeskAssets(), react()],
  base: "./",
  build: {
    outDir: resolve(__dirname, "../assets"),
    emptyOutDir: false,
    assetsDir: "",
    rollupOptions: {
      input: {
        iframe: resolve(__dirname, "iframe.html"),
      },
      output: {
        entryFileNames: "index-[hash].js",
        chunkFileNames: "index-[hash].js",
        assetFileNames: "index-[hash][extname]",
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
  },
});
