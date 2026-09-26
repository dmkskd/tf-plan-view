import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  server: {
    port: 3000,
    open: false
  },
  build: {
    outDir: "../dist",
    emptyOutDir: false
  }
});
