import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The PostgreSQL specs share one database and reuse row ids, so files run one after another.
    fileParallelism: false,
  },
});
