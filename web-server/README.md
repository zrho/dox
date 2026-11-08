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

## One-time submodule setup

From the library's Git repository root, add dox as a submodule:

```sh
git submodule add https://github.com/zrho/dox.git web/dox
git add .gitmodules web/dox web/docker-compose.yml
git commit -m 'Prepare dox web deployment'
```

Use external Git credentials with access to the private dox repository. Preparation
only writes Compose: it does not initialize, fetch, update, or stage a submodule.
The library records a specific dox commit; deploying notes does not advance it.
For an existing library checkout, initialize the recorded version with:

```sh
git submodule update --init --checkout -- web/dox
```

The pinned dox revision must contain the CLI, checked-in reader bundle, and
`web-server/server.mjs`. Push changes to dox before updating the library's pin.

## Dokploy setup

1. Create a **Docker Compose** service using the library repository as its Git
   source. Use Compose, rather than Docker Stack. The builder needs Docker
   Compose 2.17+ and BuildKit with local named build contexts.
2. Set the Compose path to `web/docker-compose.yml` and enable submodule checkout
   (`enableSubmodules`). Configure Dokploy's checkout credentials to read both
   the library and `https://github.com/zrho/dox.git`; access to the library alone
   is insufficient for a private submodule. Authentication is handled during
   checkout, before Docker starts.
3. In Dokploy's Environment panel set:
   ```dotenv
   DOX_WEB_PASSWORD='replace this with a strong shared password'
   ```
   Keep credentials out of the library repository. Quote values according to
   Compose's `.env` rules, especially when they contain dollar signs. The website
   password is passed only to the running server. `DOX_GITHUB_TOKEN` is no longer
   used by Compose and can be removed from the deployment settings.
4. Add an **HTTPS domain** for service `web`, container port **3000**, path `/`.
   Dokploy handles Traefik routing and certificates; no host port is published.
5. Deploy. Dokploy checks out the submodule revision recorded in the library.
   Docker's `dox` context is the local `web/dox` directory: there is no Git clone
   or GitHub token inside the image build. An absent or uninitialized submodule
   prevents the build from finding its source files. The first build compiles
   dox's Rust CLI. Internet access is still needed for base images, Cargo,
   system packages, and uncached Typst packages used by the library.

## Updating dox and reusing the compiler

To update dox, run these commands externally from the library root:

```sh
git submodule update --remote --checkout -- web/dox
git diff --submodule=log -- web/dox
# Review the revision, then record it in the library:
git add web/dox
git commit -m 'Update dox web deployment version'
```

Preserve any local changes in the submodule before updating. The `--remote`
command explicitly advances to dox's default branch; ordinary submodule checkout
and Dokploy deployments use the recorded commit. Updating dox can change
rendering behavior. Push the library commit to deploy the new version.

The compiler stage copies only dox's build inputs, excluding checkout metadata
and the parent library. Note files enter the later rendering stage. A note-only
deployment therefore reuses the CLI compiler layer on the same builder with its
cache retained. Changes to dox build inputs or the build recipe can rerun Cargo;
the Cargo registry and target caches are retained to reuse unchanged dependencies.
Cache eviction, a changed toolchain/base image, another builder, or a cache-disabled
build can require compilation again, even with the same pinned revision.

The built-in library Git actions allow a registered `web/dox` submodule when its
checkout is clean and matches the recorded revision. Missing checkouts, local
edits, reference changes, other submodules, and unrelated nested repositories
require external management. Submodule files do not contribute to the library's
content fingerprint or trigger note refreshes; the Git pane still checks local
status every five seconds while the window is focused and on app focus.

Library fetch, pull, and push never recurse into submodules. If a pull changes
the recorded dox revision, the library fast-forwards but further Git mutations
are blocked until the checkout matches it. Run the initialization command above
externally; dox does not fetch or reset submodule contents on your behalf.

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
- Add and commit `web/dox` externally, enable Dokploy submodule checkout, and
  deploy with checkout credentials covering both private repositories. Confirm
  Docker uses the recorded revision and renders the committed notes.
- Change only a note and redeploy on the same cached builder. Confirm the Cargo
  build step is cached while the export step reruns.
- Update and commit the dox submodule reference. Confirm checkout uses that
  revision and changed compiler inputs rebuild before rendering the library.
- Confirm normal library Git actions work with a clean deployment submodule.
  Missing, dirty, or mismatched checkouts and other submodules remain blocked.
- Pull a library commit that changes the dox reference. Confirm the library
  updates and shows the external checkout command, then resumes normal Git
  actions once the submodule matches. Submodule source edits do not refresh notes.
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
