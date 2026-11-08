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
   Compose 2.17+ for inline Dockerfiles, and BuildKit.
2. Set the Compose path to `web/docker-compose.yml`. Dokploy needs access to
   the library repository. Docker clones the public
   `https://github.com/zrho/dox.git` repository during the image build.
3. In Dokploy's Environment panel set:
   ```dotenv
   DOX_WEB_PASSWORD='replace this with a strong shared password'
   ```
   Keep the password out of the library repository. Quote values according to
   Compose's `.env` rules, especially when they contain dollar signs. The website
   password is passed only to the running server.
4. Add an **HTTPS domain** for service `web`, container port **3000**, path `/`.
   Dokploy handles Traefik routing and certificates; no host port is published.
5. Deploy. Docker clones dox and compiles the Rust CLI, then exports the library.
   The deployment needs internet access for GitHub, base images, Cargo,
   system packages, and uncached Typst packages used by the library.

## Updating dox and reusing the compiler

Rebuild/redeploy in Dokploy to obtain the latest dox default branch. The inline
Dockerfile uses `ADD https://github.com/zrho/dox.git /src/`, Docker's native Git
clone instruction. BuildKit resolves the Git source during the build and can
reuse the compiler layer when its content is unchanged. Changes to dox must be
pushed upstream before they can be used by a deployment.

The compiler stage contains dox source only. Note files enter the later rendering
stage, so a note-only deployment reuses the CLI compiler layer on the same
builder with its cache retained and unchanged dox source. A new dox version or
build recipe can rerun Cargo; the Cargo registry and target caches reuse unchanged
dependencies. Cache eviction, a changed toolchain/base image, another builder,
or a cache-disabled build can also require compilation. Upstream dox updates
can change rendering behavior even when the notes are unchanged.

## Migrating from the submodule setup

Run **Prepare web deployment** again to regenerate Compose. If the library still
tracks the old `web/dox` submodule, preserve any edits inside it, then remove it
externally from the library root:

```sh
git rm web/dox
git add web/docker-compose.yml
git commit -m 'Fetch dox during the Docker build'
git push
```

Git also updates `.gitmodules` when removing the submodule. Turn off **Enable
Submodules** in Dokploy and remove any old `DOX_GITHUB_TOKEN` setting. The only
application environment variable required by this deployment is
`DOX_WEB_PASSWORD`.

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
- Deploy a private library with only its repository credentials and the website
  password. Confirm Docker clones public dox over HTTPS and renders the notes.
- Change only a note and redeploy on the same cached builder with unchanged
  upstream dox source. Confirm the Cargo step is cached and the export reruns.
- Push an upstream dox change and rebuild. Confirm Docker obtains the update and
  rebuilds the compiler when its inputs change.
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
