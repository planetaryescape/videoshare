# Shareable project sequences and assets

Status: **shipped**

A project is an owner-managed ordered sequence of zero or more mixed-media assets. It is not a separate playlist model.

## Shipped architecture

- Assets are video, audio, or images. Each keeps its direct `/{assetSlug}` URL, publication state, and independent password grant.
- Projects use `/p/{projectSlug}` (first member), `/p/{projectSlug}/{assetSlug}`, and `/p/{projectSlug}/summary`. `summary` is reserved; `media` acts as the media prefix only when an asset slug and file path follow it, so a legacy member slugged `media` remains addressable. Generated asset slugs are 16 characters.
- Project access uses only the project cookie. It never grants a direct asset URL. A project grant can therefore show a protected member without changing its direct-link behavior.
- `ViewerCatalog` provides narrow published D1 projections for pages and one joined project-media lookup. Project media remains Worker-proxied from private R2 at `/p/{projectSlug}/media/{assetSlug}/…`, preserving relative HLS manifest/segment requests after client-side stage changes.
- The viewer server-renders the chosen member or summary, then progressively enhances it with a separate project controller. The controller is driven by the pure `ProjectPlayer` state machine (`Viewing(index)` / `Summary`), uses pushState/popstate, and swaps server-rendered inert stage templates. It makes no catalog requests from the browser.
- Timed video/audio advance only on `ended`; pause, seek, and time updates do not advance. Images never auto-advance. Ended on the final timed member and Next on the final member reach Summary.

## Admin lifecycle

Local SQLite is the editable catalog; D1 is the published catalog. Publishing uploads required media and replaces the complete published project catalog snapshot. Project metadata, ordering, filing, and member asset edits after publication are local changes until **Republish**.

Deleting a project is confirmed in the existing dialog. The published project is removed remotely first; assets/media/direct links remain and local members become unfiled. Project publish, unpublish, delete, and membership UI reports progress, blocks conflicting actions, and retains a typed retry action for failed remote project operations. Empty projects cannot publish.

## Operational verification

Local tests cover catalog behavior and UI state. A deployed check against the isolated `dev_guidefari` D1 database sent a two-statement REST `/query` batch whose first insert was valid and whose second insert failed; the endpoint returned an error and a follow-up count remained zero, confirming rollback of the first statement. Production Worker/D1/R2 smoke verification—including project authentication, HLS nested requests, and complete-catalog publication—remains required.
