import { mkdirSync } from 'node:fs';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { PlaybackCapabilities, PlaybackSession, PlaybackSessionRequest } from '@homeenter/shared-types';

type MediaFile = {
  movie: {
    id: string;
    title: string;
    backdrop: string;
    poster?: string;
    sourcePath: string;
  };
  filePath: string;
  size: number;
  mimeType: string;
};

type InternalSession = {
  id: string;
  movieId: string;
  mode: 'hls';
  title: string;
  backdrop: string;
  poster?: string;
  clientProfile: string;
  manifestPath: string;
  outputDir: string;
  status: 'preparing' | 'ready' | 'failed';
  warnings: string[];
  process: ChildProcess | null;
  createdAt: number;
  lastAccessedAt: number;
};

const DIRECT_PLAY_RULES: Record<string, Set<string>> = {
  'browser-chrome': new Set(['.m4v', '.mp4', '.webm']),
  'browser-safari': new Set(['.m4v', '.mov', '.mp4']),
  'generic-browser': new Set(['.m4v', '.mp4', '.webm']),
  'google-tv-exoplayer': new Set(['.m4v', '.mkv', '.mov', '.mp4', '.webm']),
  'tizen-tv': new Set(['.m4v', '.mp4']),
  'webos-tv': new Set(['.m4v', '.mp4'])
};

export function resolveDefaultTranscodeRoot(): string {
  return fileURLToPath(new URL('../../../data/transcodes', import.meta.url));
}

export function createPlaybackService(options?: { transcodeRoot?: string; sessionTtlMs?: number; cleanupIntervalMs?: number }) {
  const transcodeRoot = options?.transcodeRoot ?? resolveDefaultTranscodeRoot();
  const sessionTtlMs = options?.sessionTtlMs ?? 15 * 60_000;
  const cleanupIntervalMs = options?.cleanupIntervalMs ?? 60_000;
  mkdirSync(transcodeRoot, { recursive: true });

  const ffmpegAvailable = isFfmpegAvailable();
  const sessions = new Map<string, InternalSession>();
  const cleanupTimer = setInterval(() => {
    void cleanupExpiredSessions();
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  async function createSession(media: MediaFile, request: Partial<PlaybackSessionRequest>): Promise<PlaybackSession> {
    const clientProfile = resolveClientProfile(request.clientProfile);
    const preferMode = request.preferMode ?? 'auto';
    const directSupported = canDirectPlay(media.filePath, clientProfile);

    if ((preferMode === 'direct' || preferMode === 'auto') && directSupported) {
      return {
        sessionId: `direct-${media.movie.id}`,
        movieId: media.movie.id,
        mode: 'direct',
        status: 'ready',
        title: media.movie.title,
        streamUrl: `/api/movies/${media.movie.id}/stream`,
        mimeType: media.mimeType,
        backdrop: media.movie.backdrop,
        poster: media.movie.poster,
        clientProfile,
        warnings: []
      };
    }

    if (!ffmpegAvailable) {
      return {
        sessionId: `direct-${media.movie.id}`,
        movieId: media.movie.id,
        mode: 'direct',
        status: 'ready',
        title: media.movie.title,
        streamUrl: `/api/movies/${media.movie.id}/stream`,
        mimeType: media.mimeType,
        backdrop: media.movie.backdrop,
        poster: media.movie.poster,
        clientProfile,
        warnings: ['FFmpeg is not installed, so HLS fallback is unavailable in this environment.']
      };
    }

    const session = await ensureHlsSession(media, clientProfile);
    return {
      sessionId: session.id,
      movieId: media.movie.id,
      mode: 'hls',
      status: session.status,
      title: media.movie.title,
      streamUrl: `/api/playback/sessions/${session.id}/manifest.m3u8`,
      mimeType: 'application/vnd.apple.mpegurl',
      backdrop: media.movie.backdrop,
      poster: media.movie.poster,
      clientProfile,
      warnings: session.warnings
    };
  }

  async function getSession(sessionId: string): Promise<PlaybackSession | null> {
    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    touchSession(session);
    session.status = (await fileExists(session.manifestPath)) ? 'ready' : session.status;
    return {
      sessionId: session.id,
      movieId: session.movieId,
      mode: session.mode,
      status: session.status,
      title: session.title,
      streamUrl: `/api/playback/sessions/${session.id}/manifest.m3u8`,
      mimeType: 'application/vnd.apple.mpegurl',
      backdrop: session.backdrop,
      poster: session.poster,
      clientProfile: session.clientProfile,
      warnings: session.warnings
    };
  }

  async function getManifestPath(sessionId: string): Promise<string | null> {
    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    touchSession(session);
    if (await fileExists(session.manifestPath)) {
      session.status = 'ready';
      return session.manifestPath;
    }

    return null;
  }

  function getSegmentPath(sessionId: string, fileName: string): string | null {
    if (path.basename(fileName) !== fileName) {
      return null;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    touchSession(session);
    return path.join(session.outputDir, fileName);
  }

  async function heartbeat(sessionId: string): Promise<PlaybackSession | null> {
    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }

    touchSession(session);
    return getSession(sessionId);
  }

  async function stopSession(sessionId: string): Promise<boolean> {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }

    await disposeSession(sessions, sessionId, session);
    return true;
  }

  function getCapabilities(): PlaybackCapabilities {
    return {
      ffmpegAvailable,
      directPlayProfiles: Object.keys(DIRECT_PLAY_RULES),
      hlsProfiles: Object.keys(DIRECT_PLAY_RULES),
      defaultClientProfile: 'browser-chrome',
      hlsSessionTtlMs: sessionTtlMs
    };
  }

  function close(): void {
    clearInterval(cleanupTimer);
    for (const session of sessions.values()) {
      session.process?.kill('SIGTERM');
    }

    sessions.clear();
  }

  return {
    close,
    createSession,
    getCapabilities,
    heartbeat,
    getManifestPath,
    getSegmentPath,
    getSession,
    stopSession
  };

  async function ensureHlsSession(media: MediaFile, clientProfile: string): Promise<InternalSession> {
    const sessionId = `${media.movie.id}-${clientProfile}`;
    const existing = sessions.get(sessionId);
    if (existing) {
      if (await fileExists(existing.manifestPath)) {
        existing.status = 'ready';
      }

      return existing;
    }

    const outputDir = path.join(transcodeRoot, sessionId);
    mkdirSync(outputDir, { recursive: true });
    const manifestPath = path.join(outputDir, 'index.m3u8');
    const segmentPattern = path.join(outputDir, 'segment-%03d.ts');

    const process = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        media.filePath,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-b:a',
        '192k',
        '-f',
        'hls',
        '-hls_time',
        '4',
        '-hls_playlist_type',
        'event',
        '-hls_segment_filename',
        segmentPattern,
        manifestPath
      ],
      {
        stdio: 'ignore'
      }
    );

    const session: InternalSession = {
      id: sessionId,
      movieId: media.movie.id,
      mode: 'hls',
      title: media.movie.title,
      backdrop: media.movie.backdrop,
      poster: media.movie.poster,
      clientProfile,
      manifestPath,
      outputDir,
      status: 'preparing',
      warnings: ['Transcoding fallback is active for this client profile.'],
      process,
      createdAt: Date.now(),
      lastAccessedAt: Date.now()
    };

    process.on('exit', async (code) => {
      session.process = null;
      session.status = code === 0 || (code === null && (await fileExists(manifestPath))) ? 'ready' : 'failed';
      if (session.status === 'failed') {
        session.warnings = ['FFmpeg failed to prepare the HLS stream.'];
      }
    });

    sessions.set(sessionId, session);
    return session;
  }

  async function cleanupExpiredSessions(): Promise<void> {
    const now = Date.now();
    const expired: Array<[string, InternalSession]> = [];

    for (const entry of sessions.entries()) {
      if (now - entry[1].lastAccessedAt > sessionTtlMs) {
        expired.push(entry);
      }
    }

    await Promise.all(expired.map(([sessionId, session]) => disposeSession(sessions, sessionId, session)));
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function canDirectPlay(filePath: string, clientProfile: string): boolean {
  const extensions = DIRECT_PLAY_RULES[clientProfile] ?? DIRECT_PLAY_RULES['generic-browser'];
  return extensions.has(path.extname(filePath).toLowerCase());
}

function resolveClientProfile(input?: string): string {
  if (!input) {
    return 'browser-chrome';
  }

  return DIRECT_PLAY_RULES[input] ? input : 'browser-chrome';
}

function touchSession(session: InternalSession): void {
  session.lastAccessedAt = Date.now();
}

async function disposeSession(
  sessions: Map<string, InternalSession>,
  sessionId: string,
  session: InternalSession
): Promise<void> {
  session.process?.kill('SIGTERM');
  await rm(session.outputDir, { force: true, recursive: true });
  session.process = null;
  sessions.delete(sessionId);
}

function isFfmpegAvailable(): boolean {
  const result = spawnSync('ffmpeg', ['-version'], {
    stdio: 'ignore'
  });

  return result.status === 0;
}