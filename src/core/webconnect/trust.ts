import { MINI_APPS, appOrigins, type MiniApp } from '@core/miniapps/directory';

// Web connect (#250): what Lantern can say about a site asking to connect.
// The Apps directory is the only list of sites Lantern vouches for; anything
// else is "Unverified". There is no domain blocklist yet (the risk registry
// knows addresses, not domains): the approval window shows the real origin,
// and every transaction is still scanned.

/** The directory app that runs on `origin`, if any. */
export function listedApp(origin: string): MiniApp | undefined {
  return MINI_APPS.find((app) => appOrigins(app).includes(origin));
}
