package com.homeenter.tv

data class HomeItem(
  val id: String,
  val title: String,
  val year: Int,
  val durationMinutes: Int,
  val overview: String?,
  val backdrop: String?,
  val poster: String?,
  val sectionTitle: String?,
  val progressPercent: Int?,
  val progressLabel: String?
)

data class HomeSectionModel(
  val id: String,
  val title: String,
  val items: List<HomeItem>
)

data class PlaybackSessionModel(
  val sessionId: String,
  val movieId: String,
  val title: String,
  val streamUrl: String,
  val mimeType: String,
  val mode: String,
  val status: String,
  val warnings: List<String>
)

data class SubtitleTrackModel(
  val id: String,
  val language: String,
  val label: String,
  val src: String,
  val isDefault: Boolean
)

data class MovieDetailsModel(
  val id: String,
  val title: String,
  val subtitleTracks: List<SubtitleTrackModel>
)
