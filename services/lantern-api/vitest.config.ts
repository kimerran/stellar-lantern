import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@lantern/scanner': fileURLToPath(
        new URL('../../packages/lantern-scanner/src/index.ts', import.meta.url),
      ),
      '@lantern/telemetry-validate': fileURLToPath(
        new URL('../../src/core/telemetry/validate.ts', import.meta.url),
      ),
      '@lantern/telemetry-report': fileURLToPath(
        new URL('../../src/core/telemetry/report.ts', import.meta.url),
      ),
    },
  },
  // The scanner package's demo-affordance branch reads this build-time
  // literal; the proxy never wants the demo deny-list.
  define: { __FEATURE_DEMO_AFFORDANCES__: 'false' },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
