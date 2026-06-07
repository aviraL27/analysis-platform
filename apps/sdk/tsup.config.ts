import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    minify: true,
    outDir: "dist"
  },
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "analytiq",
    minify: true,
    outDir: "dist"
  }
]);
