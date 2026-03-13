# homeEnter MVP Architecture

## Goal

Build a Netflix-like home media app that works well on:

- Google TV / Android TV
- LG webOS
- Samsung Tizen
- Modern web browsers

The app should play movies stored in a network share, but the clients should not read the share directly. A central home media server handles library scanning, metadata, playback decisions, and transcoding.

## Current Implementation Status

Already implemented in this repository:

- npm workspace layout for shared types, API, and web app
- filesystem-backed movie scanning for a local or mounted library path
- SQLite persistence for library state and watch progress
- local sidecar metadata from `.nfo` files
- local subtitle sidecars from `.srt` and `.vtt` files
- local or generated poster and backdrop artwork endpoints
- direct play movie streaming with HTTP range support
- playback negotiation by client profile
- HLS fallback path backed by FFmpeg
- HLS session heartbeat, stop, and cleanup lifecycle
- browser-first web UI with playback overlay and continue watching
- Google TV native browse UI with section rails and hero area
- Google TV native playback with Media3 ExoPlayer
- Google TV native watch-progress sync and external subtitle playback
- Tizen and webOS packaging scaffolds

Not implemented yet:

- TMDB or other remote metadata providers
- embedded subtitle extraction from media containers
- production-grade HLS cleanup and lifecycle management
- authentication beyond the local single-profile scaffold
- real device certification and release packaging

## Core Decision

Use a server-centric architecture.

Clients talk to the homeEnter server over HTTP. The server reads from SMB or NFS, indexes the library, and exposes stream URLs that are adapted to the target device.

This is the only realistic way to get strong compatibility across TV platforms.

## Product Scope For MVP

The first release should support:

- One media library rooted in one network share path
- Movies only
- Local users with simple profiles
- Posters, synopsis, runtime, release year
- Continue watching
- Direct play when possible
- HLS fallback when transcoding is needed
- External subtitle files when present

The first release should not include:

- DRM
- Live TV
- Multi-room sync
- Downloads for offline viewing
- Advanced recommendations
- Series and episode management

## System Overview

### 1. Media Server

Responsibilities:

- Connect to SMB or NFS shares
- Scan files and detect changes
- Parse file metadata and subtitle sidecars
- Fetch posters and descriptions from metadata providers
- Store library state and watch progress
- Decide between direct play and transcode
- Package streams for clients

Recommended stack for MVP:

- Runtime: Node.js
- Framework: Fastify
- Database: SQLite
- Transcoding: FFmpeg
- Background jobs: lightweight internal queue

### 2. Shared Web Client

Responsibilities:

- Browse rows and collections in a TV-friendly layout
- Handle remote focus navigation
- Play streams with subtitles
- Show continue watching and movie details

Recommended stack for MVP:

- React
- Vite
- TypeScript
- hls.js for browser playback fallback

This client becomes the base for:

- Browser / PWA
- Tizen web app
- webOS web app

### 3. Google TV Client

Recommended approach:

- Build a dedicated Android TV app
- Use the same backend API as the web clients
- Prefer native playback with ExoPlayer for the best codec support and remote behavior

The UI can follow the same design system and API contracts as the web clients, but playback should remain native.

Current implementation status:

- native browse screen with section rails sourced from `GET /api/me/home`
- hero area that updates from D-pad focus
- native Media3 playback using server-created playback sessions
- periodic watch-progress sync to `POST /api/me/progress`
- external subtitle playback from sidecar `.srt` and `.vtt` files exposed as WebVTT

## Why Clients Should Not Read Network Shares Directly

Direct share access from TVs creates avoidable platform issues:

- Different support for SMB and mounted paths
- Weak authentication handling
- No reliable playback normalization
- No central control over subtitles and codecs
- Harder security model
- Worse debugging and support burden

The server should be the only component with direct access to SMB or NFS.

## Playback Strategy

### Playback Modes

1. Direct play
2. Remux only
3. Full transcode

Decision inputs:

- Container format
- Video codec and profile
- Audio codec and channel count
- Subtitle format
- Bitrate
- Client device profile

### Compatibility Baseline

Use these baseline outputs for maximum reach:

- Video: H.264
- Audio: AAC stereo for fallback
- Packaging: HLS
- Subtitle fallback: WebVTT

Higher-quality direct play remains available when the client supports it.

### Device Profiles

The server should maintain per-platform capability profiles, for example:

- browser-chrome
- browser-safari
- google-tv-exoplayer
- tizen-2023
- webos-2022

Each profile should describe:

- Supported containers
- Supported video codecs
- Supported audio codecs
- Supported subtitle types
- Max tested bitrate and resolution

## API Draft

### Authentication

For MVP, local token-based authentication is enough.

Endpoints:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`

### Library

- `GET /api/library`
- `GET /api/movies`
- `GET /api/movies/:id`
- `GET /api/movies/:id/artwork/poster`
- `GET /api/search?q=`

### Playback

- `POST /api/playback/sessions`
- `GET /api/playback/sessions/:id/manifest.m3u8`
- `GET /api/playback/sessions/:id/stream`
- `GET /api/playback/sessions/:id/subtitles/:trackId`
- `POST /api/playback/sessions/:id/heartbeat`
- `POST /api/playback/sessions/:id/stop`

### User State

- `GET /api/me/home`
- `GET /api/me/continue-watching`
- `POST /api/me/progress`
- `POST /api/me/favorites/:movieId`

## Data Model Draft

### tables

`users`

- `id`
- `name`
- `pin_hash`
- `created_at`

`libraries`

- `id`
- `name`
- `type`
- `root_path`
- `created_at`

`movies`

- `id`
- `library_id`
- `title`
- `sort_title`
- `overview`
- `release_year`
- `runtime_seconds`
- `poster_path`
- `backdrop_path`
- `content_rating`
- `created_at`
- `updated_at`

`media_files`

- `id`
- `movie_id`
- `path`
- `container`
- `video_codec`
- `audio_codec`
- `width`
- `height`
- `bitrate`
- `duration_seconds`
- `size_bytes`
- `last_seen_at`

`subtitle_tracks`

- `id`
- `movie_id`
- `language`
- `format`
- `path`
- `is_forced`

`playback_progress`

- `id`
- `user_id`
- `movie_id`
- `position_seconds`
- `duration_seconds`
- `completed`
- `updated_at`

`playback_sessions`

- `id`
- `user_id`
- `movie_id`
- `client_profile`
- `mode`
- `started_at`
- `last_heartbeat_at`

## Suggested Repo Layout

```text
homeEnter/
  apps/
    web/
    google-tv/
  services/
    api/
    worker/
  packages/
    shared-types/
    ui/
    device-profiles/
  docs/
    mvp-architecture.md
```

Notes:

- `apps/web` targets browser, Tizen, and webOS packaging
- `apps/google-tv` is the Android TV app
- `services/api` exposes HTTP APIs
- `services/worker` handles scans, metadata fetches, and transcode jobs

## Delivery Order

### Phase 1: Backend foundation

- Library scanner for one SMB path
- SQLite schema
- Movie listing API
- Metadata extraction from filenames and media info

### Phase 2: Playback foundation

- Direct play endpoint
- HLS transcoding pipeline with FFmpeg
- Subtitle normalization to WebVTT
- Watch progress updates

### Phase 3: Browser client

- TV-first home screen
- Details page
- Video player
- Continue watching row

### Phase 4: Google TV client

- Native login and browse flows
- ExoPlayer playback
- Resume support

### Phase 5: Tizen and webOS packaging

- Platform wrappers
- Remote key handling validation
- Performance tuning on real hardware

## Biggest Risks

### 1. Codec fragmentation

Mitigation:

- Central playback decision engine
- HLS fallback
- Device capability profiles

### 2. TV performance variance

Mitigation:

- Keep UI lightweight
- Limit simultaneous images and animations
- Test on lower-end TVs early

### 3. Network instability

Mitigation:

- Adaptive bitrate HLS
- Conservative prebuffering
- Playback retry logic

### 4. Undertext and subtitle inconsistency

Mitigation:

- Normalize sidecar files centrally
- Standardize on WebVTT when possible

## Immediate Next Steps

1. Initialize a monorepo with `apps`, `services`, and `packages`
2. Build the media server first
3. Define the playback session contract before building UI
4. Build the browser client as the reference implementation
5. Add Google TV after playback is stable
6. Package the shared web client for Tizen and webOS last