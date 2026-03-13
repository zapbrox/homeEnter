# homeEnter

Initial system design and MVP plan is documented in [docs/mvp-architecture.md](docs/mvp-architecture.md).

The recommended direction is:

- central media server with SMB or NFS access
- shared web client for browser, Tizen, and webOS
- dedicated Google TV client using the same backend API
- HLS fallback for cross-platform playback compatibility

## Workspace Layout

- `apps/web` contains the browser-first client that can later be packaged for Tizen and webOS.
- `services/api` contains the home media API and playback orchestration entry point.
- `packages/shared-types` contains contracts shared by the clients and server.

## Getting Started

1. Run `npm install` in the repository root.
2. Install `ffmpeg` if you want HLS fallback instead of direct-play only.
3. Put a few movie files in `media/` or point `MEDIA_LIBRARY_ROOT` at a mounted SMB or NFS path.
4. Start the API with `npm run dev:api`.
5. Start the web client with `npm run dev:web`.

The initial scaffold includes:

- a Fastify API with `GET /health`, `GET /api/library`, `GET /api/movies`, and `GET /api/me/home`
- a filesystem-backed movie scanner for a local or mounted media path
- a React web client that renders a TV-style home screen from live API data
- direct play streaming from the API with HTTP range support
- local sidecar artwork and NFO metadata support
- playback capability negotiation with optional HLS fallback when FFmpeg is installed
- a native Google TV client with section rails, hero focus state, native playback, progress sync, and subtitle support
- TV packaging scaffolds for Tizen and webOS

## Media Library Path

The API reads movie files from:

- `MEDIA_LIBRARY_ROOT` if set
- otherwise `./media` at the repository root

The API stores scan state in:

- `HOMEENTER_DB_PATH` if set
- otherwise `./data/homeenter.db`

The API stores HLS transcode output in:

- `HOMEENTER_TRANSCODE_ROOT` if set
- otherwise `./data/transcodes`

Current scanner behavior:

- recursively scans subfolders
- treats `mkv`, `mp4`, `m4v`, `mov`, `avi`, and `webm` as movie files
- derives title and year from filenames
- reads optional `.nfo` sidecars for plot and runtime
- reads optional `.srt` and `.vtt` subtitle sidecars
- uses sidecar poster and backdrop images when present
- falls back to generated artwork when no local images exist
- persists scan results in SQLite between server restarts

## Useful Endpoints

- `GET /health`
- `GET /api/library`
- `POST /api/library/scan`
- `GET /api/movies`
- `GET /api/movies/:id`
- `GET /api/movies/:id/artwork/poster`
- `GET /api/movies/:id/artwork/backdrop`
- `GET /api/movies/:id/subtitles/:trackId`
- `GET /api/movies/:id/stream`
- `GET /api/playback/capabilities`
- `POST /api/playback/sessions`
- `GET /api/playback/sessions/:sessionId`
- `POST /api/playback/sessions/:sessionId/heartbeat`
- `POST /api/playback/sessions/:sessionId/stop`
- `GET /api/playback/sessions/:sessionId/manifest.m3u8`
- `GET /api/me/home`
- `GET /api/me/continue-watching`
- `POST /api/me/progress`

## Saving Playback Progress

Send playback state as JSON to `POST /api/me/progress`:

```json
{
	"movieId": "inception-2010-mp4",
	"positionSeconds": 1820,
	"durationSeconds": 8880
}
```

The home feed will then include a real `Continue Watching` rail backed by SQLite.

## HLS Fallback

`POST /api/playback/sessions` accepts optional playback hints:

```json
{
	"movieId": "movie-id",
	"clientProfile": "browser-chrome",
	"preferMode": "auto"
}
```

If the client profile cannot direct-play the file and `ffmpeg` is available, the API prepares an HLS fallback session under `HOMEENTER_TRANSCODE_ROOT`.

HLS sessions are ephemeral. They are refreshed by manifest and segment access, can be extended explicitly with `POST /api/playback/sessions/:sessionId/heartbeat`, and can be released with `POST /api/playback/sessions/:sessionId/stop`.

On Ubuntu-based environments, install it with:

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg
```

## Platform Packaging

- Google TV scaffold lives in [apps/google-tv/README.md](apps/google-tv/README.md)
- Tizen and webOS packaging notes live in [apps/web/platforms/README.md](apps/web/platforms/README.md)
- Prepare Tizen assets with `npm run package:tizen`
- Prepare webOS assets with `npm run package:webos`

## Google TV Status

The Android TV client now includes:

- sectioned rails backed by the home feed
- a focus-driven hero area at the top of the screen
- native Media3 playback for direct play and HLS fallback sessions
- watch-progress sync to the API during playback
- external subtitle support from server-exposed WebVTT tracks