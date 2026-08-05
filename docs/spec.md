# Spec

## What this is

A tool to share videos with clients, friends, and collaborators. The owner records or has a video, publishes it from their laptop, and gets a URL. Anyone with that URL opens a nice player and watches. That is the whole product.

## The two sides

### Viewer (public)

- Polished direct-asset and mixed-media project player pages.
- Direct assets use `https://<host>/<slug>`; ordered projects use `https://<host>/p/<projectSlug>` with stable member and summary URLs.
- No accounts, no login. The link is the access.
- Optionally protected by a password for sensitive client work.
- The player itself is where we spend our effort. It should feel good.

Player features wanted:

- Custom styled controls (branded, not raw browser UI).
- Chapters / timeline markers with jump-to.
- Poster / title screen before play.
- Keyboard shortcuts (space, arrows, f, m).

### Admin (private, local-first)

- Used only by the owner, only on their laptop.
- No auth on purpose. It is local-first; it never needs to be reachable by anyone else.
- Workflow: upload a video, audio file, or image; process it for sharing; set title / description / optional password and, for timed media, chapters and a poster; then publish.
- Assets can also be ordered into projects, which are published as shareable mixed-media groups.
- Publishing pushes media to cloud storage before the published metadata/catalog reaches the cloud database the viewer reads.

## Constraints and principles

- Solo indie developer. Ship fast, validate, iterate. 80/20 over perfection.
- No premature scale engineering. This is for a small number of videos and viewers.
- The viewer must be cheap to run and reliable. The admin can be as scrappy as needed since only the owner touches it.
- Effort budget goes to the player, not to infrastructure ceremony.

## Access model

- Slug is the secret. It is long and random (16+ chars), so links are effectively unguessable.
- Optional per-asset and per-project passwords gate their respective page and media namespaces. Direct-asset and project grants are deliberately independent.
- Links could later support expiry; not built yet (YAGNI).

## Explicitly out of scope (for now)

- User accounts, teams, sharing permissions beyond slug + password.
- Comments, analytics dashboards, view tracking.
- Adaptive multi-CDN, signed media URLs, DRM.
- Mobile admin app (admin is laptop-only).
