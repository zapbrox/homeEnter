export interface MediaCard {
  id: string;
  title: string;
  year: number;
  durationMinutes: number;
  backdrop: string;
  poster?: string;
  overview?: string;
  streamUrl?: string;
  subtitleTracks?: SubtitleTrack[];
  progressPercent?: number;
  progressLabel?: string;
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label: string;
  format: 'srt' | 'vtt';
  src: string;
  isDefault?: boolean;
}

export interface MovieSummary extends MediaCard {
  sourcePath: string;
  lastModified: string;
}

export interface HomeSection {
  id: string;
  title: string;
  items: MediaCard[];
}

export interface HomePayload {
  profileName: string;
  sections: HomeSection[];
}

export interface LibraryPayload {
  rootPath: string;
  movieCount: number;
  lastScanAt: string | null;
  movies: MovieSummary[];
}

export interface PlaybackProgress {
  movieId: string;
  profileName: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface SaveProgressInput {
  movieId: string;
  positionSeconds: number;
  durationSeconds: number;
}

export interface PlaybackSessionRequest {
  movieId: string;
  clientProfile?: string;
  preferMode?: 'auto' | 'direct' | 'hls';
}

export interface PlaybackSession {
  sessionId: string;
  movieId: string;
  mode: 'direct' | 'hls';
  status: 'ready' | 'preparing' | 'failed';
  title: string;
  streamUrl: string;
  mimeType: string;
  backdrop: string;
  poster?: string;
  clientProfile: string;
  warnings: string[];
}

export interface PlaybackCapabilities {
  ffmpegAvailable: boolean;
  directPlayProfiles: string[];
  hlsProfiles: string[];
  defaultClientProfile: string;
  hlsSessionTtlMs: number;
}
