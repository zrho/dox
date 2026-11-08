# Web deployment

In the desktop command panel choose **Prepare web deployment**, or run:

```sh
dox --library ~/Notes prepare-web
```

This writes only `Notes/web/docker-compose.yml`. It does not render notes or
download dox. Run it again to update a previously generated Compose file. It
refuses to overwrite an unrelated file or follow a symlink at the destination.
Existing website exports are not deleted.

Commit the Compose file and saved library content to the library's private Git
repository. Dokploy deploys the committed files; unsaved drafts and uncommitted
local changes are not part of that checkout.

## Dokploy setup

1. Create a **Docker Compose** service using the library repository as its Git
   source. Use Compose, rather than Docker Stack. The builder needs Docker
   Compose 2.17+ and BuildKit with named Git build contexts and build secrets.
2. Set the Compose path to `web/docker-compose.yml`.
3. Create a fine-grained GitHub token with read-only contents access to
   `zrho/dox`.
4. In Dokploy's Environment panel set:
   ```dotenv
   DOX_GITHUB_TOKEN='replace this with your read-only GitHub token'
   DOX_WEB_PASSWORD='replace this with a strong shared password'
   ```
   These are deployment settings; no `.env` or credentials belong in the library
   repository. Quote values according to Compose's `.env` rules, especially when
   they contain dollar signs. Compose reads `DOX_GITHUB_TOKEN` as an
   environment-backed secret and passes it to BuildKit as `GIT_AUTH_TOKEN`.
   It is not a build argument and is not copied into an image or passed to the
   running website. The website password is passed only to the running server.
5. Add an **HTTPS domain** for service `web`, container port **3000**, path `/`.
   Dokploy handles Traefik routing and certificates; no host port is published.
6. Deploy. The first build compiles dox's Rust CLI. The deployment must have
   internet access for GitHub, Cargo, system packages, and uncached Typst
   packages used by the library.

Dokploy's key or GitHub connection for cloning the library repository is separate
from BuildKit's token for fetching dox. Rotate the token by updating
`DOX_GITHUB_TOKEN` in Dokploy. The generated Compose file contains no credential
values. When running Compose directly, export `DOX_GITHUB_TOKEN` in the shell
or supply it through Compose's `.env` settings.

The build resolves the latest default branch of `https://github.com/zrho/dox`.
The updated CLI, reader bundle, and `web-server/server.mjs` must be pushed there
before the first deployment using this Compose file. Library changes reuse the
CLI compilation layer when the upstream source has not changed. Updating dox
can change rendering behavior.

## Updates and access

Commit and push library changes, then **rebuild/redeploy** in Dokploy. The build
copies library-relative resources and notes into a temporary rendering stage,
omitting root `.git`, `.cache`, `.trash`, `web`, and `.env*` entries. Keep deployment
credentials outside the library. The CLI exports outside that temporary library.
Only the rendered website and server go into the final non-root Node image.
Library sources still exist in intermediate Docker build layers, so keep access
to the build host and its caches private.

A rendering error fails the build, with diagnostics in the build log. No partial
website is written into the Git checkout. Docker generates no content at startup.
Dokploy controls whether an existing running deployment is retained after a
failed build.

Change `DOX_WEB_PASSWORD` and recreate/redeploy the service container to rotate
the shared password. A new export or image build is unnecessary. Missing or
blank passwords prevent startup. Sessions last seven days and are invalidated
by any server restart. Credentials, login pages, and authentication endpoints
are never stored in the reader's offline cache.

Authenticated readers retain offline snapshots and chosen attachments. A password
change cannot revoke copies already downloaded to a device. **Sign out and remove
offline copies** invalidates the current session, clears this reader's caches,
unregisters its service worker, and returns open reader tabs to login. Signing out
requires a connection to the server. Browser storage deletion failures are shown
in the reader. Login attempts are limited; visitors behind Dokploy's proxy share
a login budget because the server does not trust forwarded client addresses.

The production server uses Secure cookies and assumes HTTPS at Dokploy's proxy.
For explicit localhost development only, `DOX_COOKIE_SECURE=false` allows HTTP
cookies and HTTP form origins. Do not use that setting on the public deployment.

## User acceptance checklist

These checks are for the person deploying the library; they are not run by the
development agent under this project's current workflow.

- Prepare a new deployment and prepare it again: only the generated Compose
  file changes. Unrelated files and symlink destinations are refused.
- Deploy a private library with a valid dox token. Confirm the build fetches the
  default branch, renders the committed notes, and serves through HTTPS.
- Make a rendering error and confirm the build fails rather than publishing an
  incomplete snapshot. Correct it and redeploy a changed library.
- In a fresh browser, request the home page, note JSON, images, attachments, and
  service worker directly. All require authentication.
- Try incorrect and correct passwords, expired sessions, and sign-out with
  multiple reader tabs open. Verify sign-out removes offline content.
- Recreate the container with a new password, then with a missing/blank password.
  Confirm rotation invalidates server sessions and missing passwords stop startup.
- After authenticating, wait for **Available offline**, download an attachment,
  disconnect, and read both. Reconnect and check for an updated snapshot.
- Open a PDF attachment and verify range requests, browser navigation, math,
  images, and library-relative imports in the deployed reader.
