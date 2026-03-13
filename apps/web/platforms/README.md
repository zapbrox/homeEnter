# TV Web Packaging

## Tizen

1. Run `npm run package:tizen` inside `apps/web`.
2. Open `platforms/tizen/bundle` in Tizen Studio.
3. Add platform certificates and package as a TV web app.

## webOS

1. Run `npm run package:webos` inside `apps/web`.
2. Package `platforms/webos/bundle` with `ares-package`.
3. Install to a device with `ares-install` and launch with `ares-launch`.

Both bundles are generated from the same browser-first app and keep the playback API on the homeEnter server.
