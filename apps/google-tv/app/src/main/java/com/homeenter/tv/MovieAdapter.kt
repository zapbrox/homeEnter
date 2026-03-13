package com.homeenter.tv

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import coil.load
import com.homeenter.tv.databinding.ItemMovieBinding

class MovieAdapter(
  private val onSelected: (HomeItem) -> Unit,
  private val onFocused: (HomeItem) -> Unit
) : RecyclerView.Adapter<MovieAdapter.MovieViewHolder>() {
  private val items = mutableListOf<HomeItem>()

  fun submitItems(nextItems: List<HomeItem>) {
    items.clear()
    items.addAll(nextItems)
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MovieViewHolder {
    val inflater = LayoutInflater.from(parent.context)
    val binding = ItemMovieBinding.inflate(inflater, parent, false)
    return MovieViewHolder(binding, onSelected, onFocused)
  }

  override fun onBindViewHolder(holder: MovieViewHolder, position: Int) {
    holder.bind(items[position])
  }

  override fun getItemCount(): Int = items.size

  class MovieViewHolder(
    private val binding: ItemMovieBinding,
    private val onSelected: (HomeItem) -> Unit,
    private val onFocused: (HomeItem) -> Unit
  ) : RecyclerView.ViewHolder(binding.root) {
    fun bind(item: HomeItem) {
      val context = binding.root.context
      binding.movieTitle.text = item.title
      binding.movieMeta.text = if (item.sectionTitle != null || item.progressLabel != null) {
        context.getString(
          R.string.movie_meta_with_context,
          item.year,
          item.durationMinutes,
          item.sectionTitle ?: context.getString(R.string.library_section_label),
          item.progressLabel ?: context.getString(R.string.ready_to_play_label)
        )
      } else {
        context.getString(
          R.string.movie_meta,
          item.year,
          item.durationMinutes
        )
      }
      binding.movieOverview.text = item.overview ?: binding.root.context.getString(R.string.movie_overview_fallback)
      binding.movieProgress.text = item.progressLabel ?: binding.root.context.getString(R.string.ready_to_play_label)
      binding.movieProgress.alpha = if (item.progressLabel != null) 1f else 0.72f
      binding.movieProgressBar.progress = item.progressPercent ?: 0
      binding.movieProgressBar.alpha = if (item.progressPercent != null) 1f else 0.3f
      binding.movieBackdrop.load(resolveImageUrl(item.backdrop ?: item.poster)) {
        crossfade(true)
        placeholder(ColorDrawable(Color.parseColor("#1C2B3A")))
        error(ColorDrawable(Color.parseColor("#1C2B3A")))
      }
      binding.root.setOnClickListener { onSelected(item) }
      binding.root.setOnFocusChangeListener { view, hasFocus ->
        view.scaleX = if (hasFocus) 1.04f else 1f
        view.scaleY = if (hasFocus) 1.04f else 1f
        view.alpha = if (hasFocus) 1f else 0.96f
        binding.movieBackdrop.alpha = if (hasFocus) 1f else 0.92f
        if (hasFocus) {
          onFocused(item)
        }
      }
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
  }
}
