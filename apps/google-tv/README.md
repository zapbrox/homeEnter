# Google TV Scaffold

This directory contains the first native Android TV flow for homeEnter.

## Current approach

- Native Android TV browse screen backed by the existing homeEnter API, rendered as sectioned rails
- Rail cards now load backdrop artwork directly from the API and show resume progress visually
- Cards and hero artwork can fall back to poster images when no backdrop is available
- Focusing a card updates a featured hero area at the top of the screen with artwork, metadata, and overview
- The featured hero area now includes a Play or Resume action for the currently focused title
- The hero area also exposes a lightweight More info dialog and becomes the initial focus target after loading
- Native playback activity using Media3 ExoPlayer
- Uses the existing playback session API for both direct play and HLS fallback
- Sends playback heartbeats and stops sessions explicitly when playback exits
- Saves watch-progress back to the homeEnter API while playback runs and when playback stops
- Loads external subtitle tracks from movie details and attaches them to Media3 as WebVTT subtitles

## Prerequisites

- Android Studio Ladybug or newer
- Android SDK 35
- Java 17

## Next steps

1. Add a Gradle wrapper with `gradle wrapper` from Android Studio or local Gradle.
2. Point `HOMEENTER_API_URL` in `app/build.gradle.kts` to the local or hosted API.
3. Verify D-pad focus behavior and subtitle selection on a real Google TV device or emulator.
4. Add richer artwork treatments or poster-based rails where backdrop cards are not the best fit.
