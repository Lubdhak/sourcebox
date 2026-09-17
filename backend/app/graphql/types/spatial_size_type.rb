# frozen_string_literal: true

module Types
  # Exposed as `SpatialSize`.
  class SpatialSizeType < Types::BaseObject
    description "A node's extents, as the renderer should draw it."

    field :width, Float
    field :height, Float
    field :depth, Float, description: "The z-axis counterpart of width and height. Zero for flat nodes."
  end
end
