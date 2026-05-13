// backend/vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false, // garantiza que los ficheros corren uno tras otro
  },
});
