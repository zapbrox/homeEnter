import { useEffect, useRef, useState } from 'react';
import type { HomePayload, MediaCard, PlaybackCapabilities, PlaybackSession } from '@homeenter/shared-types';

const fallbackPayload: HomePayload = {
  profileName: 'Family',
  sections: [
    {
      id: 'offline',
      title: 'Preview Mode',
      items: [
        {
          id: 'demo-1',
          title: 'Offline Preview',
          year: 2026,
          durationMinutes: 120,
          backdrop: 'https://images.unsplash.com/photo-1520034475321-cbe63696469a?auto=format&fit=crop&w=1200&q=80',
          progressPercent: 42,
          progressLabel: '68 min left'
        }
      ]
    }
  ]
};

export default function App() {
  const [home, setHome] = useState<HomePayload>(fallbackPayload);
  const [status, setStatus] = useState('Connecting to media server...');
  const [selected, setSelected] = useState<MediaCard | null>(null);
  const [playback, setPlayback] = useState<PlaybackSession | null>(null);
  const [capabilities, setCapabilities] = useState<PlaybackCapabilities | null>(null);
  const [playerStatus, setPlayerStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHome() {
      try {
        const [homeResponse, capabilitiesResponse] = await Promise.all([
          fetch('/api/me/home'),
          fetch('/api/playback/capabilities')
        ]);

        if (!homeResponse.ok || !capabilitiesResponse.ok) {
          throw new Error('Request failed');
        }

        const payload = (await homeResponse.json()) as HomePayload;
        const playbackCapabilities = (await capabilitiesResponse.json()) as PlaybackCapabilities;

        if (!cancelled) {
          setHome(payload);
          setCapabilities(playbackCapabilities);
          setStatus('Connected to local media server');
        }
      } catch {
        if (!cancelled) {
          setStatus('Showing fallback data until the media server is running');
        }
      }
    }

    void loadHome();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current || !playback) {
      return;
    }

    const currentElement = videoRef.current;
    const currentPlayback = playback;

    let pollTimer: number | undefined;
    let hls: import('hls.js').default | null = null;

    if (currentPlayback.mode === 'direct') {
      currentElement.src = currentPlayback.streamUrl;
      return () => {
        currentElement.removeAttribute('src');
        currentElement.load();
      };
    }

    async function attachHls() {
      if (currentPlayback.status !== 'ready') {
        pollTimer = window.setTimeout(async () => {
          try {
            const response = await fetch(`/api/playback/sessions/${currentPlayback.sessionId}`);
            if (!response.ok) {
              throw new Error('Polling playback session failed');
            }

            const next = (await response.json()) as PlaybackSession;
            setPlayback(next);
            setPlayerStatus(next.status === 'preparing' ? 'Preparing HLS fallback...' : 'HLS fallback ready');
          } catch {
            setPlayerStatus('Could not prepare HLS fallback');
          }
        }, 1500);
        return;
      }

      if (currentElement.canPlayType('application/vnd.apple.mpegurl')) {
        currentElement.src = currentPlayback.streamUrl;
        return;
      }

      const hlsModule = await import('hls.js');
      const Hls = hlsModule.default;

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(currentPlayback.streamUrl);
        hls.attachMedia(currentElement);
        return;
      }

      setPlayerStatus('This browser cannot play the HLS fallback stream');
    }

    void attachHls();

    return () => {
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }

      hls?.destroy();
      currentElement.removeAttribute('src');
      currentElement.load();
    };
  }, [playback]);

  const hero = home.sections[0]?.items[0];

  async function openMovie(item: MediaCard) {
    setSelected(item);
    setPlayerStatus('Preparing playback...');

    try {
      const response = await fetch('/api/playback/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          movieId: item.id,
          clientProfile: capabilities?.defaultClientProfile ?? 'browser-chrome',
          preferMode: 'auto'
        })
      });

      if (!response.ok) {
        throw new Error('Playback session failed');
      }

      const payload = (await response.json()) as PlaybackSession;
      setPlayback(payload);
      setPlayerStatus(
        payload.mode === 'direct'
          ? payload.warnings[0] ?? 'Direct play session ready'
          : payload.status === 'ready'
            ? 'HLS fallback ready'
            : 'Preparing HLS fallback...'
      );
    } catch {
      setPlayback(null);
      setPlayerStatus('Could not start playback session');
    }
  }

  function closePlayer() {
    setSelected(null);
    setPlayback(null);
    setPlayerStatus('');
  }

  return (
    <main className="app-shell">
      <section
        className="hero"
        style={{ backgroundImage: hero ? `linear-gradient(90deg, rgba(12, 17, 24, 0.96) 0%, rgba(12, 17, 24, 0.55) 55%, rgba(12, 17, 24, 0.2) 100%), url(${hero.backdrop})` : undefined }}
      >
        <div className="hero-copy">
          <p className="eyebrow">homeEnter</p>
          <h1>Your private streaming room</h1>
          <p className="hero-text">
            A TV-first interface for movies stored on your network share, streamed through a central media server.
          </p>
          <div className="hero-meta">
            <span>{home.profileName}</span>
            <span>{status}</span>
          </div>
        </div>
      </section>

      {home.sections.map((section) => (
        <section key={section.id} className="rail">
          <div className="rail-header">
            <h2>{section.title}</h2>
            <span>{section.items.length} titles</span>
          </div>
          <div className="card-row">
            {section.items.map((item) => (
              <article
                key={item.id}
                className="card"
                tabIndex={0}
                onClick={() => void openMovie(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openMovie(item);
                  }
                }}
              >
                <div className="card-image" style={{ backgroundImage: `url(${item.backdrop})` }} />
                <div className="card-copy">
                  <h3>{item.title}</h3>
                  <p>
                    {item.year} • {item.durationMinutes} min
                  </p>
                  {typeof item.progressPercent === 'number' ? (
                    <div className="progress-block" aria-label={item.progressLabel}>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${item.progressPercent}%` }} />
                      </div>
                      <span>{item.progressLabel}</span>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      {selected ? (
        <section className="player-shell" aria-label="Playback overlay">
          <div className="player-panel">
            <button type="button" className="close-button" onClick={closePlayer}>
              Close
            </button>
            <div className="player-copy">
              <p className="eyebrow">{playback?.mode === 'hls' ? 'HLS Fallback' : 'Direct Play'}</p>
              <h2>{selected.title}</h2>
              <p>{selected.overview ?? 'Direct playback from the local homeEnter media server.'}</p>
              <p className="player-status">{playerStatus}</p>
              {playback?.warnings.length ? <p className="player-warning">{playback.warnings[0]}</p> : null}
            </div>
            {playback ? (
              <video
                ref={videoRef}
                className="player-video"
                controls
                autoPlay
                playsInline
                poster={playback.poster ?? selected.poster ?? selected.backdrop}
                onTimeUpdate={(event) => {
                  const element = event.currentTarget;
                  if (!Number.isFinite(element.duration) || element.duration <= 0) {
                    return;
                  }

                  if (Math.floor(element.currentTime) % 15 !== 0) {
                    return;
                  }

                  void fetch('/api/me/progress', {
                    method: 'POST',
                    headers: {
                      'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                      movieId: selected.id,
                      positionSeconds: Math.floor(element.currentTime),
                      durationSeconds: Math.floor(element.duration)
                    })
                  });
                }}
              >
                {selected.subtitleTracks?.map((track) => (
                  <track
                    key={track.id}
                    kind="subtitles"
                    src={track.src}
                    srcLang={track.language}
                    label={track.label}
                    default={track.isDefault}
                  />
                ))}
              </video>
            ) : (
              <div className="player-placeholder" style={{ backgroundImage: `url(${selected.backdrop})` }} />
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
