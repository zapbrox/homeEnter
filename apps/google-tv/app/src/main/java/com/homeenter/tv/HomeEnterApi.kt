package com.homeenter.tv

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class HomeEnterApi(private val baseUrl: String) {
  fun fetchHomeSections(): List<HomeSectionModel> {
    val response = getJsonObject("/api/me/home")
    val sections = response.getJSONArray("sections")
    val parsedSections = mutableListOf<HomeSectionModel>()

    for (sectionIndex in 0 until sections.length()) {
      val section = sections.getJSONObject(sectionIndex)
      val sectionId = section.optString("id").ifBlank { "section-$sectionIndex" }
      val sectionTitle = section.optString("title").ifBlank { null }
      val sectionItems = parseItems(section.getJSONArray("items"), sectionTitle)
      if (sectionItems.isNotEmpty()) {
        parsedSections += HomeSectionModel(
          id = sectionId,
          title = sectionTitle ?: "Section",
          items = sectionItems
        )
      }
    }

    return parsedSections
  }

  fun createPlaybackSession(movieId: String): PlaybackSessionModel {
    val payload = JSONObject()
      .put("movieId", movieId)
      .put("clientProfile", "google-tv-exoplayer")
      .put("preferMode", "auto")

    val response = postJsonObject("/api/playback/sessions", payload)
    val warnings = mutableListOf<String>()
    val warningsArray = response.optJSONArray("warnings") ?: JSONArray()
    for (index in 0 until warningsArray.length()) {
      warnings += warningsArray.getString(index)
    }

    return PlaybackSessionModel(
      sessionId = response.getString("sessionId"),
      movieId = response.getString("movieId"),
      title = response.getString("title"),
      streamUrl = response.getString("streamUrl"),
      mimeType = response.getString("mimeType"),
      mode = response.getString("mode"),
      status = response.getString("status"),
      warnings = warnings
    )
  }

  fun fetchMovieDetails(movieId: String): MovieDetailsModel {
    val response = getJsonObject("/api/movies/$movieId")
    val subtitleTracks = mutableListOf<SubtitleTrackModel>()
    val subtitleArray = response.optJSONArray("subtitleTracks") ?: JSONArray()
    for (index in 0 until subtitleArray.length()) {
      val track = subtitleArray.getJSONObject(index)
      subtitleTracks += SubtitleTrackModel(
        id = track.getString("id"),
        language = track.optString("language").ifBlank { "und" },
        label = track.optString("label").ifBlank { "Subtitles" },
        src = track.getString("src"),
        isDefault = track.optBoolean("isDefault", false)
      )
    }

    return MovieDetailsModel(
      id = response.getString("id"),
      title = response.getString("title"),
      subtitleTracks = subtitleTracks
    )
  }

  fun heartbeatPlaybackSession(sessionId: String): PlaybackSessionModel {
    val response = postJsonObject("/api/playback/sessions/$sessionId/heartbeat", JSONObject())
    val warnings = mutableListOf<String>()
    val warningsArray = response.optJSONArray("warnings") ?: JSONArray()
    for (index in 0 until warningsArray.length()) {
      warnings += warningsArray.getString(index)
    }

    return PlaybackSessionModel(
      sessionId = response.getString("sessionId"),
      movieId = response.getString("movieId"),
      title = response.getString("title"),
      streamUrl = response.getString("streamUrl"),
      mimeType = response.getString("mimeType"),
      mode = response.getString("mode"),
      status = response.getString("status"),
      warnings = warnings
    )
  }

  fun stopPlaybackSession(sessionId: String) {
    postJsonObject("/api/playback/sessions/$sessionId/stop", JSONObject())
  }

  fun saveProgress(movieId: String, positionSeconds: Int, durationSeconds: Int) {
    val payload = JSONObject()
      .put("movieId", movieId)
      .put("positionSeconds", positionSeconds)
      .put("durationSeconds", durationSeconds)

    postJsonObject("/api/me/progress", payload)
  }

  private fun getJsonObject(path: String): JSONObject {
    val connection = openConnection(path, "GET")
    return connection.inputStream.bufferedReader().use(BufferedReader::readText).let(::JSONObject)
  }

  private fun postJsonObject(path: String, payload: JSONObject): JSONObject {
    val connection = openConnection(path, "POST")
    connection.doOutput = true
    connection.setRequestProperty("Content-Type", "application/json")
    OutputStreamWriter(connection.outputStream).use { writer ->
      writer.write(payload.toString())
    }

    return connection.inputStream.bufferedReader().use(BufferedReader::readText).let(::JSONObject)
  }

  private fun openConnection(path: String, method: String): HttpURLConnection {
    val url = URL("$baseUrl$path")
    return (url.openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 5000
      readTimeout = 15000
    }
  }

  private fun parseItems(items: JSONArray, sectionTitle: String?): List<HomeItem> {
    return buildList {
      for (index in 0 until items.length()) {
        val item = items.getJSONObject(index)
        add(
          HomeItem(
            id = item.getString("id"),
            title = item.getString("title"),
            year = item.optInt("year", 0),
            durationMinutes = item.optInt("durationMinutes", 0),
            overview = item.optString("overview").ifBlank { null },
            backdrop = item.optString("backdrop").ifBlank { null },
            poster = item.optString("poster").ifBlank { null },
            sectionTitle = sectionTitle,
            progressPercent = item.optInt("progressPercent").takeIf { item.has("progressPercent") },
            progressLabel = item.optString("progressLabel").ifBlank { null }
          )
        )
      }
    }
  }
}
