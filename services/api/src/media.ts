import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SubtitleTrack } from '@homeenter/shared-types';

export type ArtworkKind = 'backdrop' | 'poster';

type MetadataResult = {
  durationMinutes: number;
  overview?: string;
};

type ArtworkAsset =
  | {
      mode: 'file';
      filePath: string;
      mimeType: string;
    }
  | {
      mode: 'generated';
      body: string;
      mimeType: 'image/svg+xml';
    };

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt']);

export function buildArtworkUrl(id: string, kind: ArtworkKind): string {
  return `/api/movies/${id}/artwork/${kind}`;
}

export function buildStreamUrl(id: string): string {
  return `/api/movies/${id}/stream`;
}

export function buildSubtitleUrl(id: string, trackId: string): string {
  return `/api/movies/${id}/subtitles/${trackId}`;
}

export function getMimeTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.m4v':
    case '.mp4':
      return 'video/mp4';
    case '.mkv':
      return 'video/x-matroska';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.avi':
      return 'video/x-msvideo';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export function resolveMoviePath(rootPath: string, sourcePath: string): string {
  const absoluteRoot = path.resolve(rootPath);
  const absoluteFile = path.resolve(absoluteRoot, sourcePath);

  if (!absoluteFile.startsWith(`${absoluteRoot}${path.sep}`) && absoluteFile !== absoluteRoot) {
    throw new Error('Resolved movie path escapes the media root');
  }

  return absoluteFile;
}

export async function readLocalMetadata(moviePath: string): Promise<MetadataResult> {
  const nfoPath = replaceExtension(moviePath, '.nfo');
  const nfoContent = await readTextIfExists(nfoPath);
  if (!nfoContent) {
    return { durationMinutes: 0 };
  }

  const outline = extractTag(nfoContent, 'plot') ?? extractTag(nfoContent, 'outline');
  const runtimeMinutes = Number(extractTag(nfoContent, 'runtime') ?? '0');

  return {
    durationMinutes: Number.isFinite(runtimeMinutes) ? runtimeMinutes : 0,
    overview: outline?.trim() || undefined
  };
}

export async function resolveArtworkAsset(moviePath: string, kind: ArtworkKind, title: string): Promise<ArtworkAsset> {
  const sidecar = await findSidecarArtwork(moviePath, kind);
  if (sidecar) {
    return {
      mode: 'file',
      filePath: sidecar,
      mimeType: getMimeTypeForPath(sidecar)
    };
  }

  return {
    mode: 'generated',
    body: makeArtworkSvg(title, kind),
    mimeType: 'image/svg+xml'
  };
}

export async function findSubtitleTracks(moviePath: string, movieId: string): Promise<SubtitleTrack[]> {
  const directory = path.dirname(moviePath);
  const basename = path.basename(moviePath, path.extname(moviePath)).toLowerCase();
  const entries = await safeReadDirectory(directory);

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const extension = path.extname(name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(extension)) {
        return false;
      }

      return path.basename(name, extension).toLowerCase().startsWith(basename);
    })
    .map((name, index) => {
      const extension = path.extname(name).toLowerCase() as '.srt' | '.vtt';
      const parsed = parseSubtitleDescriptor(path.basename(name, extension), basename);
      return {
        id: toTrackId(name),
        language: parsed.language,
        label: parsed.label,
        format: extension === '.srt' ? 'srt' : 'vtt',
        src: buildSubtitleUrl(movieId, toTrackId(name)),
        isDefault: index === 0
      } satisfies SubtitleTrack;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export async function resolveSubtitleTrack(moviePath: string, trackId: string): Promise<{ body: string; mimeType: 'text/vtt' } | null> {
  const directory = path.dirname(moviePath);
  const entries = await safeReadDirectory(directory);

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (toTrackId(entry.name) !== trackId) {
      continue;
    }

    const filePath = path.join(directory, entry.name);
    const extension = path.extname(entry.name).toLowerCase();
    const content = await readFile(filePath, 'utf8');

    return {
      body: extension === '.srt' ? convertSrtToVtt(content) : ensureWebVtt(content),
      mimeType: 'text/vtt'
    };
  }

  return null;
}

async function findSidecarArtwork(moviePath: string, kind: ArtworkKind): Promise<string | null> {
  const directory = path.dirname(moviePath);
  const basename = path.basename(moviePath, path.extname(moviePath));
  const baseCandidates =
    kind === 'poster'
      ? [`${basename}-poster`, basename, 'poster', 'folder', 'cover']
      : [`${basename}-backdrop`, `${basename}-fanart`, `${basename}-thumb`, 'backdrop', 'fanart'];

  for (const baseName of baseCandidates) {
    for (const extension of IMAGE_EXTENSIONS) {
      const candidate = path.join(directory, `${baseName}${extension}`);
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDirectory(directory: string) {
  try {
    const fs = await import('node:fs/promises');
    return await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function replaceExtension(filePath: string, extension: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

function parseSubtitleDescriptor(rawBaseName: string, movieBaseName: string): { language: string; label: string } {
  const suffix = rawBaseName.slice(movieBaseName.length).replace(/^[._ -]+/, '');
  const tokens = suffix.split(/[._ -]+/).filter(Boolean);
  const languageToken = tokens.find((token) => /^[a-z]{2,3}$/i.test(token))?.toLowerCase() ?? 'und';
  const label = languageToken === 'und' ? 'Subtitles' : languageToken.toUpperCase();

  return {
    language: languageToken,
    label
  };
}

function toTrackId(fileName: string): string {
  return fileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function convertSrtToVtt(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const cueBlocks = normalized
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      if (/^\d+$/.test(lines[0] ?? '')) {
        lines.shift();
      }

      if (lines[0]) {
        lines[0] = lines[0].replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
      }

      return lines.join('\n');
    });

  return ensureWebVtt(cueBlocks.join('\n\n'));
}

function ensureWebVtt(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (normalized.startsWith('WEBVTT')) {
    return `${normalized}\n`;
  }

  return `WEBVTT\n\n${normalized}\n`;
}

function extractTag(value: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = value.match(pattern);
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim() ?? null;
}

function makeArtworkSvg(title: string, kind: ArtworkKind): string {
  const seed = hashString(`${title}:${kind}`);
  const first = `hsl(${seed % 360} 70% 52%)`;
  const second = `hsl(${(seed + 70) % 360} 76% 30%)`;
  const third = `hsl(${(seed + 140) % 360} 72% 18%)`;
  const labelY = kind === 'poster' ? 1040 : 628;
  const viewBox = kind === 'poster' ? '0 0 800 1200' : '0 0 1280 720';
  const width = kind === 'poster' ? 800 : 1280;
  const height = kind === 'poster' ? 1200 : 720;
  const circle = kind === 'poster'
    ? '<circle cx="620" cy="200" r="150" fill="rgba(255,255,255,0.12)" />'
    : '<circle cx="1060" cy="140" r="220" fill="rgba(255,255,255,0.16)" />';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${first}" />
          <stop offset="50%" stop-color="${second}" />
          <stop offset="100%" stop-color="${third}" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)" />
      ${circle}
      <circle cx="140" cy="${kind === 'poster' ? 1060 : 660}" r="${kind === 'poster' ? 200 : 260}" fill="rgba(255,255,255,0.08)" />
      <text x="${kind === 'poster' ? 44 : 72}" y="${labelY}" fill="rgba(255,255,255,0.92)" font-family="Segoe UI, sans-serif" font-size="${kind === 'poster' ? 52 : 72}" font-weight="700">${escapeXml(title)}</text>
    </svg>
  `;
}

function hashString(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
