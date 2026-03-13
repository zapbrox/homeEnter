import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
const fallbackPayload = {
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
    const [home, setHome] = useState(fallbackPayload);
    const [status, setStatus] = useState('Connecting to media server...');
    const [selected, setSelected] = useState(null);
    const [playback, setPlayback] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    const [playerStatus, setPlayerStatus] = useState('');
    const videoRef = useRef(null);
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
                const payload = (await homeResponse.json());
                const playbackCapabilities = (await capabilitiesResponse.json());
                if (!cancelled) {
                    setHome(payload);
                    setCapabilities(playbackCapabilities);
                    setStatus('Connected to local media server');
                }
            }
            catch {
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
        let pollTimer;
        let hls = null;
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
                        const next = (await response.json());
                        setPlayback(next);
                        setPlayerStatus(next.status === 'preparing' ? 'Preparing HLS fallback...' : 'HLS fallback ready');
                    }
                    catch {
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
    async function openMovie(item) {
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
            const payload = (await response.json());
            setPlayback(payload);
            setPlayerStatus(payload.mode === 'direct'
                ? payload.warnings[0] ?? 'Direct play session ready'
                : payload.status === 'ready'
                    ? 'HLS fallback ready'
                    : 'Preparing HLS fallback...');
        }
        catch {
            setPlayback(null);
            setPlayerStatus('Could not start playback session');
        }
    }
    function closePlayer() {
        setSelected(null);
        setPlayback(null);
        setPlayerStatus('');
    }
    return (_jsxs("main", { className: "app-shell", children: [_jsx("section", { className: "hero", style: { backgroundImage: hero ? `linear-gradient(90deg, rgba(12, 17, 24, 0.96) 0%, rgba(12, 17, 24, 0.55) 55%, rgba(12, 17, 24, 0.2) 100%), url(${hero.backdrop})` : undefined }, children: _jsxs("div", { className: "hero-copy", children: [_jsx("p", { className: "eyebrow", children: "homeEnter" }), _jsx("h1", { children: "Your private streaming room" }), _jsx("p", { className: "hero-text", children: "A TV-first interface for movies stored on your network share, streamed through a central media server." }), _jsxs("div", { className: "hero-meta", children: [_jsx("span", { children: home.profileName }), _jsx("span", { children: status })] })] }) }), home.sections.map((section) => (_jsxs("section", { className: "rail", children: [_jsxs("div", { className: "rail-header", children: [_jsx("h2", { children: section.title }), _jsxs("span", { children: [section.items.length, " titles"] })] }), _jsx("div", { className: "card-row", children: section.items.map((item) => (_jsxs("article", { className: "card", tabIndex: 0, onClick: () => void openMovie(item), onKeyDown: (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    void openMovie(item);
                                }
                            }, children: [_jsx("div", { className: "card-image", style: { backgroundImage: `url(${item.backdrop})` } }), _jsxs("div", { className: "card-copy", children: [_jsx("h3", { children: item.title }), _jsxs("p", { children: [item.year, " \u2022 ", item.durationMinutes, " min"] }), typeof item.progressPercent === 'number' ? (_jsxs("div", { className: "progress-block", "aria-label": item.progressLabel, children: [_jsx("div", { className: "progress-track", children: _jsx("div", { className: "progress-fill", style: { width: `${item.progressPercent}%` } }) }), _jsx("span", { children: item.progressLabel })] })) : null] })] }, item.id))) })] }, section.id))), selected ? (_jsx("section", { className: "player-shell", "aria-label": "Playback overlay", children: _jsxs("div", { className: "player-panel", children: [_jsx("button", { type: "button", className: "close-button", onClick: closePlayer, children: "Close" }), _jsxs("div", { className: "player-copy", children: [_jsx("p", { className: "eyebrow", children: playback?.mode === 'hls' ? 'HLS Fallback' : 'Direct Play' }), _jsx("h2", { children: selected.title }), _jsx("p", { children: selected.overview ?? 'Direct playback from the local homeEnter media server.' }), _jsx("p", { className: "player-status", children: playerStatus }), playback?.warnings.length ? _jsx("p", { className: "player-warning", children: playback.warnings[0] }) : null] }), playback ? (_jsx("video", { ref: videoRef, className: "player-video", controls: true, autoPlay: true, playsInline: true, poster: playback.poster ?? selected.poster ?? selected.backdrop, onTimeUpdate: (event) => {
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
                            }, children: selected.subtitleTracks?.map((track) => (_jsx("track", { kind: "subtitles", src: track.src, srcLang: track.language, label: track.label, default: track.isDefault }, track.id))) })) : (_jsx("div", { className: "player-placeholder", style: { backgroundImage: `url(${selected.backdrop})` } }))] }) })) : null] }));
}
