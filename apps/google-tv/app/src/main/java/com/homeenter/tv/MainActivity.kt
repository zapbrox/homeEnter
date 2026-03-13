package com.homeenter.tv

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import coil.load
import com.homeenter.tv.databinding.ActivityMainBinding
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
  private lateinit var binding: ActivityMainBinding
  private val api = HomeEnterApi(BuildConfig.HOMEENTER_API_URL)
  private var heroItem: HomeItem? = null
  private var shouldRefreshOnResume = false
  private val adapter = HomeRailAdapter(
    onSelected = { item ->
      playItem(item)
    },
    onFocused = { item ->
      renderHero(item)
    }
  )

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    binding = ActivityMainBinding.inflate(layoutInflater)
    setContentView(binding.root)

    binding.sectionList.layoutManager = LinearLayoutManager(this)
    binding.sectionList.adapter = adapter
    binding.heroPlayButton.setOnClickListener {
      heroItem?.let(::playItem)
    }
    binding.heroInfoButton.setOnClickListener {
      heroItem?.let(::showHeroDetails)
    }

    loadHome()
  }

  override fun onResume() {
    super.onResume()
    if (shouldRefreshOnResume) {
      shouldRefreshOnResume = false
      loadHome()
    }
  }

  private fun loadHome() {
    binding.statusText.text = getString(R.string.loading_home)
    thread {
      runCatching { api.fetchHomeSections() }
        .onSuccess { sections ->
          runOnUiThread {
            adapter.submitSections(sections)
            val totalItems = sections.sumOf { it.items.size }
            val preservedHero = sections
              .asSequence()
              .flatMap { it.items.asSequence() }
              .firstOrNull { it.id == heroItem?.id }
            val nextHero = preservedHero ?: sections.firstOrNull()?.items?.firstOrNull()
            nextHero?.let {
              renderHero(it)
              if (!binding.heroPlayButton.hasFocus() && !binding.heroInfoButton.hasFocus()) {
                binding.heroPlayButton.requestFocus()
              }
            }
            binding.statusText.text = if (totalItems == 0) {
              getString(R.string.no_movies_found)
            } else {
              getString(R.string.home_loaded_sections, sections.size, totalItems)
            }
          }
        }
        .onFailure {
          runOnUiThread {
            binding.statusText.text = getString(R.string.home_load_failed)
          }
        }
    }
  }

  private fun renderHero(item: HomeItem) {
    heroItem = item
    binding.heroTitle.text = item.title
    binding.heroMeta.text = if (item.sectionTitle != null || item.progressLabel != null) {
      getString(
        R.string.movie_meta_with_context,
        item.year,
        item.durationMinutes,
        item.sectionTitle ?: getString(R.string.library_section_label),
        item.progressLabel ?: getString(R.string.ready_to_play_label)
      )
    } else {
      getString(R.string.movie_meta, item.year, item.durationMinutes)
    }
    binding.heroOverview.text = item.overview ?: getString(R.string.movie_overview_fallback)
    binding.heroPlayButton.text = if ((item.progressPercent ?: 0) > 0) {
      getString(R.string.resume_playback)
    } else {
      getString(R.string.play_now)
    }
    binding.heroBackdrop.load(resolveImageUrl(item.backdrop ?: item.poster)) {
      crossfade(true)
      placeholder(ColorDrawable(Color.parseColor("#142232")))
      error(ColorDrawable(Color.parseColor("#142232")))
    }
  }

  private fun showHeroDetails(item: HomeItem) {
    val message = buildString {
      append(
        if (item.sectionTitle != null || item.progressLabel != null) {
          getString(
            R.string.movie_meta_with_context,
            item.year,
            item.durationMinutes,
            item.sectionTitle ?: getString(R.string.library_section_label),
            item.progressLabel ?: getString(R.string.ready_to_play_label)
          )
        } else {
          getString(R.string.movie_meta, item.year, item.durationMinutes)
        }
      )
      append("\n\n")
      append(item.overview ?: getString(R.string.movie_overview_fallback))
    }

    AlertDialog.Builder(this)
      .setTitle(item.title)
      .setMessage(message)
      .setPositiveButton(
        if ((item.progressPercent ?: 0) > 0) {
          R.string.resume_playback
        } else {
          R.string.play_now
        }
      ) { _, _ ->
        playItem(item)
      }
      .setNegativeButton(android.R.string.cancel, null)
      .show()
  }

  private fun resolveImageUrl(path: String?): String? {
    if (path.isNullOrBlank()) {
      return null
    }

    return if (path.startsWith("http://") || path.startsWith("https://")) {
      path
    } else {
      "${BuildConfig.HOMEENTER_API_URL}$path"
    }
  }

  private fun playItem(item: HomeItem) {
    binding.statusText.text = getString(R.string.creating_playback_session, item.title)
    thread {
      runCatching { api.createPlaybackSession(item.id) }
        .onSuccess { session ->
          runOnUiThread {
            shouldRefreshOnResume = true
            binding.statusText.text = session.warnings.firstOrNull() ?: getString(R.string.playback_ready, session.title)
            startActivity(PlayerActivity.createIntent(this, session))
          }
        }
        .onFailure {
          runOnUiThread {
            binding.statusText.text = getString(R.string.playback_failed)
          }
        }
    }
  }
}

