import { defineConfig } from "vitest/config";

// The extension compiles to ES modules, so src imports use ".js" specifiers that
// point at ".ts" files. Vite needs the alias to resolve them.
export default defineConfig({
  resolve: {
    alias: [{ find: /^(\.\.?\/.*)\.js$/, replacement: "$1" }],
  },
});
