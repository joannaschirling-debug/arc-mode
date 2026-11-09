import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: "dist", target: "es2020" }
});
