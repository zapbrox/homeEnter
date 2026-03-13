import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { LibraryPayload, MovieSummary, PlaybackProgress } from '@homeenter/shared-types';
import { buildArtworkUrl, buildStreamUrl } from './media';

type MovieRow = {
  id: string;
  title: string;
  year: number;
  duration_minutes: number;
  backdrop: string;
  source_path: string;
  last_modified: string;
};

type ScanStateRow = {
  root_path: string;
  last_scan_at: string | null;
};

type ProgressRow = {
  movie_id: string;
  profile_name: string;
  position_seconds: number;
  duration_seconds: number;
  updated_at: string;
};

export interface LibraryRepository {
  getLibrary(): LibraryPayload | null;
  getMovieById(id: string): MovieSummary | null;
  getContinueWatching(profileName: string): PlaybackProgress[];
  saveProgress(progress: PlaybackProgress): void;
  replaceLibrary(payload: LibraryPayload): void;
  close(): void;
}

export function resolveDefaultDatabasePath(): string {
  return fileURLToPath(new URL('../../../data/homeenter.db', import.meta.url));
}

export function createLibraryRepository(databasePath: string): LibraryRepository {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      root_path TEXT NOT NULL,
      last_scan_at TEXT
    );

    CREATE TABLE IF NOT EXISTS movies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      backdrop TEXT NOT NULL,
      source_path TEXT NOT NULL,
      last_modified TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playback_progress (
      movie_id TEXT NOT NULL,
      profile_name TEXT NOT NULL,
      position_seconds INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (movie_id, profile_name),
      FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS movies_title_idx ON movies(title);
    CREATE INDEX IF NOT EXISTS movies_last_modified_idx ON movies(last_modified);
    CREATE INDEX IF NOT EXISTS playback_progress_profile_updated_idx ON playback_progress(profile_name, updated_at DESC);
  `);

  ensureMoviesTableColumns(database);

  const readScanState = database.prepare<[], ScanStateRow>('SELECT root_path, last_scan_at FROM scan_state WHERE id = 1');
  const readMovies = database.prepare<[], MovieRow>(`
    SELECT id, title, year, duration_minutes, backdrop, source_path, last_modified
    FROM movies
    ORDER BY title ASC
  `);
  const readMovieById = database.prepare<[string], MovieRow>(`
    SELECT id, title, year, duration_minutes, backdrop, source_path, last_modified
    FROM movies
    WHERE id = ?
  `);
  const readContinueWatching = database.prepare<[string], ProgressRow>(`
    SELECT movie_id, profile_name, position_seconds, duration_seconds, updated_at
    FROM playback_progress
    WHERE profile_name = ?
      AND position_seconds > 0
      AND duration_seconds > 0
      AND position_seconds < duration_seconds
    ORDER BY updated_at DESC
    LIMIT 12
  `);
  const clearMovies = database.prepare('DELETE FROM movies');
  const upsertScanState = database.prepare(`
    INSERT INTO scan_state (id, root_path, last_scan_at)
    VALUES (1, @rootPath, @lastScanAt)
    ON CONFLICT(id) DO UPDATE SET
      root_path = excluded.root_path,
      last_scan_at = excluded.last_scan_at
  `);
  const insertMovie = database.prepare(`
    INSERT INTO movies (id, title, year, duration_minutes, backdrop, source_path, last_modified)
    VALUES (@id, @title, @year, @durationMinutes, @backdrop, @sourcePath, @lastModified)
  `);
  const upsertProgress = database.prepare(`
    INSERT INTO playback_progress (movie_id, profile_name, position_seconds, duration_seconds, updated_at)
    VALUES (@movieId, @profileName, @positionSeconds, @durationSeconds, @updatedAt)
    ON CONFLICT(movie_id, profile_name) DO UPDATE SET
      position_seconds = excluded.position_seconds,
      duration_seconds = excluded.duration_seconds,
      updated_at = excluded.updated_at
  `);

  const replaceLibraryTransaction = database.transaction((payload: LibraryPayload) => {
    clearMovies.run();
    upsertScanState.run({
      rootPath: payload.rootPath,
      lastScanAt: payload.lastScanAt
    });

    for (const movie of payload.movies) {
      insertMovie.run({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        durationMinutes: movie.durationMinutes,
        backdrop: movie.backdrop,
        sourcePath: movie.sourcePath,
        lastModified: movie.lastModified
      });
    }
  });

  return {
    getLibrary() {
      const state = readScanState.get();
      if (!state) {
        return null;
      }

      const movies = readMovies.all().map(mapMovieRow);
      return {
        rootPath: state.root_path,
        movieCount: movies.length,
        lastScanAt: state.last_scan_at,
        movies
      };
    },

    getMovieById(id: string) {
      const row = readMovieById.get(id);
      return row ? mapMovieRow(row) : null;
    },

    getContinueWatching(profileName: string) {
      return readContinueWatching.all(profileName).map(mapProgressRow);
    },

    saveProgress(progress: PlaybackProgress) {
      upsertProgress.run({
        movieId: progress.movieId,
        profileName: progress.profileName,
        positionSeconds: progress.positionSeconds,
        durationSeconds: progress.durationSeconds,
        updatedAt: progress.updatedAt
      });
    },

    replaceLibrary(payload: LibraryPayload) {
      replaceLibraryTransaction(payload);
    },

    close() {
      database.close();
    }
  };
}

function mapMovieRow(row: MovieRow): MovieSummary {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    durationMinutes: row.duration_minutes,
    backdrop: buildArtworkUrl(row.id, 'backdrop'),
    poster: buildArtworkUrl(row.id, 'poster'),
    streamUrl: buildStreamUrl(row.id),
    sourcePath: row.source_path,
    lastModified: row.last_modified
  };
}

function mapProgressRow(row: ProgressRow): PlaybackProgress {
  return {
    movieId: row.movie_id,
    profileName: row.profile_name,
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    updatedAt: row.updated_at
  };
}

function ensureMoviesTableColumns(database: Database.Database): void {
  const columns = database.prepare<[], { name: string }>('PRAGMA table_info(movies)').all().map((column) => column.name);

  if (!columns.includes('backdrop')) {
    database.exec("ALTER TABLE movies ADD COLUMN backdrop TEXT NOT NULL DEFAULT ''");
  }
}
