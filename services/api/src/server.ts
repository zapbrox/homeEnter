import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createReadStream } from 'node:fs';
import type { PlaybackSessionRequest, SaveProgressInput } from '@homeenter/shared-types';
import { createLibraryRepository, resolveDefaultDatabasePath } from './database';
import { createLibraryService, resolveDefaultLibraryRoot } from './library';
import { createPlaybackService, resolveDefaultTranscodeRoot } from './playback';

const app = Fastify({ logger: true });

const libraryRoot = process.env.MEDIA_LIBRARY_ROOT ?? resolveDefaultLibraryRoot();
const databasePath = process.env.HOMEENTER_DB_PATH ?? resolveDefaultDatabasePath();
const transcodeRoot = process.env.HOMEENTER_TRANSCODE_ROOT ?? resolveDefaultTranscodeRoot();
const libraryRepository = createLibraryRepository(databasePath);
const libraryService = createLibraryService(libraryRoot, libraryRepository);
const playbackService = createPlaybackService({ transcodeRoot });

await app.register(cors, {
  origin: true
});

app.get('/health', async () => {
  const library = await libraryService.getLibrary();
  const playback = playbackService.getCapabilities();

  return {
    status: 'ok',
    libraryRoot: library.rootPath,
    movieCount: library.movieCount,
    lastScanAt: library.lastScanAt,
    ffmpegAvailable: playback.ffmpegAvailable,
    transcodeRoot
  };
});

app.get('/api/playback/capabilities', async () => playbackService.getCapabilities());

app.get('/api/library', async () => libraryService.getLibrary());

app.post('/api/library/scan', async () => libraryService.getLibrary(true));

app.get('/api/movies', async () => {
  const library = await libraryService.getLibrary();
  return library.movies;
});

app.get('/api/movies/:id', async (request, reply) => {
  const movie = await libraryService.getMovieById((request.params as { id: string }).id);

  if (!movie) {
    reply.code(404);
    return { message: 'Movie not found' };
  }

  return movie;
});

app.get('/api/movies/:id/artwork/:kind', async (request, reply) => {
  const params = request.params as { id: string; kind: 'backdrop' | 'poster' };
  const artwork = await libraryService.getArtwork(params.id, params.kind);

  if (!artwork) {
    reply.code(404);
    return { message: 'Movie artwork not found' };
  }

  if (artwork.asset.mode === 'file') {
    reply.header('content-type', artwork.asset.mimeType);
    return reply.send(createReadStream(artwork.asset.filePath));
  }

  reply.header('content-type', artwork.asset.mimeType);
  return artwork.asset.body;
});

app.get('/api/movies/:id/subtitles/:trackId', async (request, reply) => {
  const params = request.params as { id: string; trackId: string };
  const subtitle = await libraryService.getSubtitle(params.id, params.trackId);
  if (!subtitle) {
    reply.code(404);
    return { message: 'Subtitle track not found' };
  }

  reply.header('content-type', subtitle.subtitle.mimeType);
  return subtitle.subtitle.body;
});

app.get('/api/movies/:id/stream', async (request, reply) => {
  const media = await libraryService.getMovieFile((request.params as { id: string }).id);
  if (!media) {
    reply.code(404);
    return { message: 'Movie not found' };
  }

  if (media.size <= 0) {
    reply.code(409);
    return { message: 'Movie file is empty and cannot be streamed' };
  }

  const range = request.headers.range;
  reply.header('accept-ranges', 'bytes');
  reply.header('content-type', media.mimeType);

  if (!range) {
    reply.header('content-length', String(media.size));
    return reply.send(createReadStream(media.filePath));
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    reply.code(416);
    return { message: 'Invalid range header' };
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : media.size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end >= media.size) {
    reply.code(416);
    reply.header('content-range', `bytes */${media.size}`);
    return { message: 'Requested range not satisfiable' };
  }

  reply.code(206);
  reply.header('content-length', String(end - start + 1));
  reply.header('content-range', `bytes ${start}-${end}/${media.size}`);
  return reply.send(createReadStream(media.filePath, { start, end }));
});

app.post('/api/playback/sessions', async (request, reply) => {
  const body = request.body as Partial<PlaybackSessionRequest>;
  if (!body.movieId) {
    reply.code(400);
    return { message: 'movieId is required' };
  }

  const media = await libraryService.getMovieFile(body.movieId);
  if (!media) {
    reply.code(404);
    return { message: 'Movie not found' };
  }

  return playbackService.createSession(media, body);
});

app.get('/api/playback/sessions/:sessionId', async (request, reply) => {
  const session = await playbackService.getSession((request.params as { sessionId: string }).sessionId);
  if (!session) {
    reply.code(404);
    return { message: 'Playback session not found' };
  }

  return session;
});

app.post('/api/playback/sessions/:sessionId/heartbeat', async (request, reply) => {
  const session = await playbackService.heartbeat((request.params as { sessionId: string }).sessionId);
  if (!session) {
    reply.code(404);
    return { message: 'Playback session not found' };
  }

  return session;
});

app.post('/api/playback/sessions/:sessionId/stop', async (request, reply) => {
  const stopped = await playbackService.stopSession((request.params as { sessionId: string }).sessionId);
  if (!stopped) {
    reply.code(404);
    return { message: 'Playback session not found' };
  }

  return { status: 'stopped' };
});

app.get('/api/playback/sessions/:sessionId/manifest.m3u8', async (request, reply) => {
  const sessionId = (request.params as { sessionId: string }).sessionId;
  const manifestPath = await playbackService.getManifestPath(sessionId);
  if (!manifestPath) {
    const session = await playbackService.getSession(sessionId);
    if (!session) {
      reply.code(404);
      return { message: 'Playback session not found' };
    }

    if (session.status === 'failed') {
      reply.code(503);
      return { message: 'HLS transcoding failed' };
    }

    reply.code(202);
    return { message: 'HLS stream is still preparing' };
  }

  reply.header('content-type', 'application/vnd.apple.mpegurl');
  return reply.send(createReadStream(manifestPath));
});

app.get('/api/playback/sessions/:sessionId/:segmentName', async (request, reply) => {
  const params = request.params as { sessionId: string; segmentName: string };
  const segmentPath = playbackService.getSegmentPath(params.sessionId, params.segmentName);
  if (!segmentPath) {
    reply.code(404);
    return { message: 'HLS segment not found' };
  }

  reply.header('content-type', params.segmentName.endsWith('.m4s') ? 'video/iso.segment' : 'video/mp2t');
  return reply.send(createReadStream(segmentPath));
});

app.get('/api/me/home', async () => libraryService.getHomePayload());

app.get('/api/me/continue-watching', async () => libraryService.getContinueWatching());

app.post('/api/me/progress', async (request, reply) => {
  const body = request.body as Partial<SaveProgressInput>;

  if (!body.movieId || typeof body.positionSeconds !== 'number' || typeof body.durationSeconds !== 'number') {
    reply.code(400);
    return { message: 'movieId, positionSeconds, and durationSeconds are required' };
  }

  const movie = await libraryService.saveProgress({
    movieId: body.movieId,
    positionSeconds: body.positionSeconds,
    durationSeconds: body.durationSeconds
  });

  if (!movie) {
    reply.code(404);
    return { message: 'Movie not found' };
  }

  return { status: 'ok', movieId: movie.id };
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.addHook('onClose', async () => {
  playbackService.close();
  libraryService.close();
});

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
