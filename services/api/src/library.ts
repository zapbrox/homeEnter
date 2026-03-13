import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  HomePayload,
  LibraryPayload,
  MediaCard,
  MovieSummary,
  SaveProgressInput
} from '@homeenter/shared-types';
import type { LibraryRepository } from './database';
import {
  buildArtworkUrl,
  buildStreamUrl,
  findSubtitleTracks,
  getMimeTypeForPath,
  readLocalMetadata,
  resolveArtworkAsset,
  resolveSubtitleTrack,
  resolveMoviePath,
  type ArtworkKind
} from './media';

const MOVIE_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.webm']);
const STALE_AFTER_MS = 60_000;
const DEFAULT_PROFILE_NAME = 'Family';

export function resolveDefaultLibraryRoot(): string {
  return fileURLToPath(new URL('../../../media', import.meta.url));
}

export function createLibraryService(rootPath: string, repository: LibraryRepository) {
  let cache: LibraryPayload | null = null;
  let inflightScan: Promise<LibraryPayload> | null = null;

  async function getLibrary(forceRefresh = false): Promise<LibraryPayload> {
    if (!cache) {
      cache = repository.getLibrary();
    }

    if (!forceRefresh && cache && !isStale(cache.lastScanAt)) {
      return cache;
    }

    if (!inflightScan) {
      inflightScan = scanLibrary(rootPath)
        .then((payload) => {
          repository.replaceLibrary(payload);
          cache = payload;
          return payload;
        })
        .finally(() => {
          inflightScan = null;
        });
    }

    return inflightScan;
  }

  async function getMovieById(id: string): Promise<MovieSummary | null> {
    if (!cache) {
      cache = repository.getLibrary();
    }

    const cachedMovie = cache?.movies.find((movie) => movie.id === id) ?? repository.getMovieById(id);
    if (cachedMovie) {
      return cachedMovie;
    }

    const library = await getLibrary();
    const movie = library.movies.find((item) => item.id === id) ?? null;
    if (!movie) {
      return null;
    }

    const metadata = await readLocalMetadata(resolveMoviePath(rootPath, movie.sourcePath));
    const subtitleTracks = await findSubtitleTracks(resolveMoviePath(rootPath, movie.sourcePath), movie.id);
    return {
      ...movie,
      durationMinutes: movie.durationMinutes || metadata.durationMinutes,
      overview: metadata.overview ?? movie.overview,
      subtitleTracks
    };
  }

  async function getHomePayload(): Promise<HomePayload> {
    const library = await getLibrary();
    const continueWatching = repository.getContinueWatching(DEFAULT_PROFILE_NAME).reduce<MediaCard[]>((items, progress) => {
        const movie = library.movies.find((item) => item.id === progress.movieId);
        if (!movie) {
          return items;
        }

        items.push({
          ...movie,
          progressPercent: Math.max(0, Math.min(100, Math.round((progress.positionSeconds / progress.durationSeconds) * 100))),
          progressLabel: formatProgress(progress.positionSeconds, progress.durationSeconds)
        });

        return items;
      }, []);

    const recentlyAdded = [...library.movies]
      .filter((movie) => !continueWatching.some((item) => item.id === movie.id))
      .sort((left, right) => Date.parse(right.lastModified) - Date.parse(left.lastModified))
      .slice(0, 8);

    const allMovies = [...library.movies]
      .sort((left, right) => left.title.localeCompare(right.title))
      .slice(0, 12);

    return {
      profileName: DEFAULT_PROFILE_NAME,
      sections: [
        {
          id: 'continue-watching',
          title: 'Continue Watching',
          items: continueWatching
        },
        {
          id: 'recently-added',
          title: 'Recently Added',
          items: recentlyAdded
        },
        {
          id: 'library',
          title: 'Library',
          items: allMovies
        }
      ].filter((section) => section.items.length > 0)
    };
  }

  return {
    getHomePayload,
    getLibrary,
    getMovieById,
    getContinueWatching() {
      return repository.getContinueWatching(DEFAULT_PROFILE_NAME);
    },
    async getMovieFile(id: string) {
      const movie = await getMovieById(id);
      if (!movie) {
        return null;
      }

      const filePath = resolveMoviePath(rootPath, movie.sourcePath);
      const details = await stat(filePath);

      return {
        movie,
        filePath,
        size: details.size,
        mimeType: getMimeTypeForPath(filePath)
      };
    },
    async getArtwork(id: string, kind: ArtworkKind) {
      const movie = await getMovieById(id);
      if (!movie) {
        return null;
      }

      const filePath = resolveMoviePath(rootPath, movie.sourcePath);
      const asset = await resolveArtworkAsset(filePath, kind, movie.title);
      return {
        movie,
        asset
      };
    },
    async getSubtitle(id: string, trackId: string) {
      const movie = await getMovieById(id);
      if (!movie) {
        return null;
      }

      const filePath = resolveMoviePath(rootPath, movie.sourcePath);
      const subtitle = await resolveSubtitleTrack(filePath, trackId);
      if (!subtitle) {
        return null;
      }

      return {
        movie,
        subtitle
      };
    },
    async saveProgress(input: SaveProgressInput) {
      const movie = await getMovieById(input.movieId);
      if (!movie) {
        return null;
      }

      const normalizedPosition = Math.max(0, Math.min(input.positionSeconds, input.durationSeconds));

      repository.saveProgress({
        movieId: input.movieId,
        profileName: DEFAULT_PROFILE_NAME,
        positionSeconds: normalizedPosition,
        durationSeconds: Math.max(1, input.durationSeconds),
        updatedAt: new Date().toISOString()
      });

      return movie;
    },
    close() {
      repository.close();
    }
  };
}

async function scanLibrary(rootPath: string): Promise<LibraryPayload> {
  const moviePaths = await findMovieFiles(rootPath);
  const movies = await Promise.all(moviePaths.map((moviePath) => toMovieSummary(rootPath, moviePath)));

  return {
    rootPath,
    movieCount: movies.length,
    lastScanAt: new Date().toISOString(),
    movies: movies.sort((left, right) => left.title.localeCompare(right.title))
  };
}

async function findMovieFiles(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    const discovered: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        discovered.push(...(await findMovieFiles(entryPath)));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (MOVIE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        discovered.push(entryPath);
      }
    }

    return discovered;
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }

    throw error;
  }
}

async function toMovieSummary(rootPath: string, moviePath: string): Promise<MovieSummary> {
  const details = await stat(moviePath);
  const relativePath = path.relative(rootPath, moviePath);
  const fileName = path.basename(moviePath, path.extname(moviePath));
  const parsed = parseMovieName(fileName);
  const id = toSlug(relativePath);
  const metadata = await readLocalMetadata(moviePath);
  const subtitleTracks = await findSubtitleTracks(moviePath, id);

  return {
    id,
    title: parsed.title,
    year: parsed.year,
    durationMinutes: metadata.durationMinutes,
    backdrop: buildArtworkUrl(id, 'backdrop'),
    poster: buildArtworkUrl(id, 'poster'),
    overview: metadata.overview,
    streamUrl: buildStreamUrl(id),
    subtitleTracks,
    sourcePath: relativePath,
    lastModified: details.mtime.toISOString()
  };
}

function parseMovieName(fileName: string): { title: string; year: number } {
  const normalized = fileName.replace(/[._]+/g, ' ').replace(/-/g, ' ');
  const yearMatch = normalized.match(/(19|20)\d{2}/);
  const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();

  const titleWithoutYear = yearMatch ? normalized.slice(0, yearMatch.index).trim() : normalized.trim();
  const cleanedTitle = titleWithoutYear
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: toTitleCase(cleanedTitle || fileName),
    year
  };
}

function toTitleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function isStale(lastScanAt: string | null): boolean {
  if (!lastScanAt) {
    return true;
  }

  return Date.now() - Date.parse(lastScanAt) > STALE_AFTER_MS;
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOENT';
}

function formatProgress(positionSeconds: number, durationSeconds: number): string {
  const remainingSeconds = Math.max(0, durationSeconds - positionSeconds);
  const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
  return `${remainingMinutes} min left`;
}
