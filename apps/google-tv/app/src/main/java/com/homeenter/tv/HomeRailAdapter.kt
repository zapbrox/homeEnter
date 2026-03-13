package com.homeenter.tv

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.homeenter.tv.databinding.ItemHomeSectionBinding

class HomeRailAdapter(
  private val onSelected: (HomeItem) -> Unit,
  private val onFocused: (HomeItem) -> Unit
) : RecyclerView.Adapter<HomeRailAdapter.HomeSectionViewHolder>() {
  private val sections = mutableListOf<HomeSectionModel>()

  fun submitSections(nextSections: List<HomeSectionModel>) {
    sections.clear()
    sections.addAll(nextSections)
    notifyDataSetChanged()
  }

  override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): HomeSectionViewHolder {
    val inflater = LayoutInflater.from(parent.context)
    val binding = ItemHomeSectionBinding.inflate(inflater, parent, false)
    return HomeSectionViewHolder(binding, onSelected, onFocused)
  }

  override fun onBindViewHolder(holder: HomeSectionViewHolder, position: Int) {
    holder.bind(sections[position])
  }

  override fun getItemCount(): Int = sections.size

  class HomeSectionViewHolder(
    private val binding: ItemHomeSectionBinding,
    onSelected: (HomeItem) -> Unit,
    onFocused: (HomeItem) -> Unit
  ) : RecyclerView.ViewHolder(binding.root) {
    private val railAdapter = MovieAdapter(onSelected, onFocused)

    init {
      binding.sectionRail.layoutManager = LinearLayoutManager(binding.root.context, RecyclerView.HORIZONTAL, false)
      binding.sectionRail.adapter = railAdapter
      binding.sectionRail.setItemViewCacheSize(12)
    }

    fun bind(section: HomeSectionModel) {
      binding.sectionTitle.text = section.title
      binding.sectionCount.text = binding.root.context.getString(R.string.section_count, section.items.size)
      railAdapter.submitItems(section.items)
    }
  }
}