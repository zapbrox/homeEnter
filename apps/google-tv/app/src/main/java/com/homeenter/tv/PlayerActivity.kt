package com.homeenter.tv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.homeenter.tv.databinding.ActivityPlayerBinding
import kotlin.concurrent.thread

class PlayerActivity : AppCompatActivity() {
  private lateinit var binding: ActivityPlayerBinding
  private val api = HomeEnterApi(BuildConfig.HOMEENTER_API_URL)
  private val heartbeatHandler = Handler(Looper.getMainLooper())
  private var player: ExoPlayer? = null
  private var movieId: String? = null
  private var sessionId: String? = null
  private var lastSavedPositionSeconds = -1
  private val heartbeatRunnable = object : Runnable {
    override fun run() {
      val activeSessionId = sessionId ?: return
      thread {
        runCatching { api.heartbeatPlaybackSession(activeSessionId) }
      }
      heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
    }
  }
  private val progressRunnable = object : Runnable {
    override fun run() {
      saveProgress()
      heartbeatHandler.postDelayed(this, PROGRESS_SAVE_INTERVAL_MS)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    binding = ActivityPlayerBinding.inflate(layoutInflater)
    setContentView(binding.root)

    movieId = intent.getStringExtra(EXTRA_MOVIE_ID)
    sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
    binding.playerTitle.text = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.app_name)
    binding.playerStatus.text = intent.getStringExtra(EXTRA_MODE)?.uppercase() ?: "PLAYBACK"
  }

  override fun onStart() {
    super.onStart()
    initializePlayer()
    heartbeatHandler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
    heartbeatHandler.postDelayed(progressRunnable, PROGRESS_SAVE_INTERVAL_MS)
  }

  override fun onStop() {
    super.onStop()
    heartbeatHandler.removeCallbacks(heartbeatRunnable)
    heartbeatHandler.removeCallbacks(progressRunnable)
    saveProgress()
    stopSession()
    releasePlayer()
  }

  private fun initializePlayer() {
    val streamUrl = intent.getStringExtra(EXTRA_STREAM_URL) ?: return
    val activeMovieId = movieId

    thread {
      val subtitleTracks = activeMovieId?.let { movieIdToLoad ->
        runCatching { api.fetchMovieDetails(movieIdToLoad).subtitleTracks }
          .getOrDefault(emptyList())
      } ?: emptyList()

      runOnUiThread {
        val exoPlayer = ExoPlayer.Builder(this).build()
        binding.playerView.player = exoPlayer
        exoPlayer.setMediaItem(buildMediaItem(streamUrl, subtitleTracks))
        exoPlayer.addListener(
          object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
              if (!isPlaying) {
                saveProgress()
              }
            }
          }
        )
        exoPlayer.prepare()
        exoPlayer.playWhenReady = true
        player = exoPlayer
      }
    }
  }

  private fun releasePlayer() {
    binding.playerView.player = null
    player?.release()
    player = null
  }

  private fun stopSession() {
    val activeSessionId = sessionId ?: return
    thread {
      runCatching { api.stopPlaybackSession(activeSessionId) }
    }
  }

  private fun saveProgress() {
    val activeMovieId = movieId ?: return
    val activePlayer = player ?: return
    val durationMs = activePlayer.duration
    val positionMs = activePlayer.currentPosition
    if (durationMs <= 0L || positionMs < 0L) {
      return
    }

    val positionSeconds = (positionMs / 1000L).toInt()
    val durationSeconds = (durationMs / 1000L).toInt()
    if (durationSeconds <= 0 || positionSeconds == lastSavedPositionSeconds) {
      return
    }

    lastSavedPositionSeconds = positionSeconds
    thread {
      runCatching { api.saveProgress(activeMovieId, positionSeconds, durationSeconds) }
    }
  }

  private fun buildMediaItem(streamUrl: String, subtitleTracks: List<SubtitleTrackModel>): MediaItem {
    val builder = MediaItem.Builder().setUri(streamUrl)

    if (subtitleTracks.isNotEmpty()) {
      builder.setSubtitleConfigurations(
        subtitleTracks.map { track ->
          MediaItem.SubtitleConfiguration.Builder(Uri.parse(qualifyUrl(track.src)))
            .setMimeType(MimeTypes.TEXT_VTT)
            .setLanguage(track.language)
            .setLabel(track.label)
            .setSelectionFlags(if (track.isDefault) C.SELECTION_FLAG_DEFAULT else 0)
            .build()
        }
      )
      binding.playerStatus.text = getString(R.string.playback_with_subtitles, subtitleTracks.size)
    }

    return builder.build()
  }

  companion object {
    private const val HEARTBEAT_INTERVAL_MS = 30_000L
    private const val PROGRESS_SAVE_INTERVAL_MS = 15_000L
    private const val EXTRA_MOVIE_ID = "movie_id"
    private const val EXTRA_SESSION_ID = "session_id"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_STREAM_URL = "stream_url"
    private const val EXTRA_MODE = "mode"

    fun createIntent(context: Context, session: PlaybackSessionModel): Intent {
      return Intent(context, PlayerActivity::class.java)
        .putExtra(EXTRA_MOVIE_ID, session.movieId)
        .putExtra(EXTRA_SESSION_ID, session.sessionId)
        .putExtra(EXTRA_TITLE, session.title)
        .putExtra(EXTRA_STREAM_URL, qualifyStreamUrl(session.streamUrl))
        .putExtra(EXTRA_MODE, session.mode)
    }

    private fun qualifyStreamUrl(path: String): String {
      return qualifyUrl(path)
    }

    private fun qualifyUrl(path: String): String {
      return if (path.startsWith("http://") || path.startsWith("https://")) {
        path
      } else {
        "${BuildConfig.HOMEENTER_API_URL}$path"
      }
    }
  }
}
