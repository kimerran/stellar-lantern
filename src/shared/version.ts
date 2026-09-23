// The app version the telemetry envelope reports (and Settings → About shows).
// Read from package.json — the one place a version is written (#141). The
// extension manifest and android/app/build.gradle read the same field, and
// tests/version.test.ts fails if any surface drifts. A named JSON import, so
// the bundle inlines the version string and none of the rest of package.json.
import { version } from '../../package.json';

export const APP_VERSION: string = version;
