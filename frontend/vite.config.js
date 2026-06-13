import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" })],
  build: {
    outDir: "../dist",
    lib: {
      entry: "src/index.jsx",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: { inlineDynamicImports: true },
    },
    cssCodeSplit: false,
  },
});
