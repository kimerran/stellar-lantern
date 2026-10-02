# Hosting the web app (`app.golantern.xyz`)

The web app (#236) is a static site: serve the committed `webapp/` directory as-is, over HTTPS only, on its **own origin**. Never serve it under `golantern.xyz/…`: the playground at `/demo` loads third-party wallet-connector code that must never share an origin with a stored wallet.

`webapp/` is rebuilt by `npm run build:web` and checked in CI (`build:web -- --check`), so deploy what's committed and don't rebuild it on the host.

## Response headers

`webapp/index.html` already carries the Content-Security-Policy in a `<meta>` tag. Browsers ignore `frame-ancestors` there, and the other protections below exist only as headers, so the host must send them too.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | the policy from `src/web/csp.ts` (also in `webapp/index.html`), **plus** `; frame-ancestors 'none'` | `frame-ancestors` only works as a header. It stops another site from framing the wallet and tricking clicks through it. The page also refuses to start in a frame, but the header is the real control. |
| `X-Frame-Options` | `DENY` | The same, for older browsers. |
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS only, always. |
| `X-Content-Type-Options` | `nosniff` | Scripts only run as scripts. |
| `Referrer-Policy` | `no-referrer` | Nothing about the wallet leaks to the sites it links to. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | The web app uses none of them. |

At the time of writing, the policy is:

```
default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://friendbot.stellar.org https://lantern-api-production-3fad.up.railway.app; frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

If `src/web/csp.ts` changes, update the header to match. A header and a `<meta>` policy both apply, and the browser enforces both.

## Caching

| Path | `Cache-Control` | Why |
|---|---|---|
| `/sw.js`, `/index.html`, `/` | `no-cache` | Always revalidated, so a new build is seen on the next launch. |
| `/assets/*` | `public, max-age=31536000, immutable` | Content-hashed file names: a new build gets new names. |
| everything else | `no-cache` | Small, and not content-hashed. |

## What the browser stores

The encrypted wallet lives in the browser's IndexedDB on this origin. **Changing the domain loses every user's wallet** (they would have to import their recovery phrase again), so pick the final origin before anyone uses it.

## Check after deploying

- `curl -sI https://app.golantern.xyz/` shows the headers above.
- *Verify it yourself*, section 3, on the evidence site: the served files match `webapp/SHA256SUMS`.
