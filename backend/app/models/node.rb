# frozen_string_literal: true

# The single documentation entity.
#
# A product, a service, a database table, a team, a business rule and an external system
# are all nodes. They differ in `node_type` and in the content blocks they carry, not in
# their storage, which is what makes the same node reachable from many places without its
# content being copied.
#
# Position (`x`, `y`, `z`) lives here rather than in the renderer. The canvas is one view
# over this data; a tree, a list, a dependency graph or a WebGL scene are others, and none
# of them owns the layout.
class Node < ApplicationRecord
  belongs_to :documentation_space

  has_many :content_blocks, -> { ordered }, dependent: :destroy, inverse_of: :node

  # Both directions are needed: the canvas draws edges from their source, and
  # "what depends on this?" reads them from their target.
  has_many :outgoing_relationships,
           class_name: "NodeRelationship",
           foreign_key: :source_node_id,
           dependent: :destroy,
           inverse_of: :source_node
  has_many :incoming_relationships,
           class_name: "NodeRelationship",
           foreign_key: :target_node_id,
           dependent: :destroy,
           inverse_of: :target_node

  # A suggested vocabulary, not a closed set.
  #
  # The column is a string and there is no inclusion validation, because the whole point
  # of "everything is a node" is that a team can document anything they care about.
  # These values exist so the seeds and the UI's type picker have something consistent
  # to start from; users are free to use any label they like.
  SUGGESTED_TYPES = %w[
    product service module api database table queue feature
    workflow business_rule team person external_system
  ].freeze

  MAX_SERIALIZED_METADATA_BYTES = 16.kilobytes

  # Positions are user-dragged, so they are bounded to keep a stray value from placing a
  # node effectively infinitely far away, which no renderer can recover from by panning.
  COORDINATE_LIMIT = 1_000_000.0

  validates :title, presence: true, length: { maximum: 200 }
  validates :node_type, presence: true, length: { maximum: 60 }
  validates :summary, length: { maximum: 4_000 }, allow_blank: true
  validates :x, :y, :z,
            presence: true,
            numericality: { greater_than_or_equal_to: -COORDINATE_LIMIT, less_than_or_equal_to: COORDINATE_LIMIT }
  validates :width, :height,
            presence: true,
            numericality: { greater_than: 0, less_than_or_equal_to: 10_000 }
  validates :depth,
            presence: true,
            numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 10_000 }
  validate :metadata_must_be_a_bounded_object

  scope :ordered, -> { order(:id) }

  # Viewport loading.
  scope :within, ->(min_x, min_y, max_x, max_y) {
    where(x: min_x..max_x, y: min_y..max_y)
  }

  # Ranked full-text search against the generated `search_vector` column.
  scope :matching, ->(query) {
    where("search_vector @@ websearch_to_tsquery('english', ?)", query)
  }

  def position
    { x: x, y: y, z: z }
  end

  private

  def metadata_must_be_a_bounded_object
    unless metadata.is_a?(Hash)
      errors.add(:metadata, "must be a JSON object")
      return
    end

    if metadata.to_json.bytesize > MAX_SERIALIZED_METADATA_BYTES
      errors.add(:metadata, "exceeds #{MAX_SERIALIZED_METADATA_BYTES / 1024}KB")
    end
  end
end
