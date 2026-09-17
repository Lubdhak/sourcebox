# frozen_string_literal: true

module Types
  # Exposed as `SpatialPosition`.
  #
  # `z` is here from the first version even though the initial renderer is 2.5D. The
  # domain is not allowed to know which renderer is reading it, and the difference between
  # having this field now and adding it later is the difference between swapping a
  # renderer and migrating every node in every space.
  class SpatialPositionType < Types::BaseObject
    description "A node's position in space."

    field :x, Float
    field :y, Float
    field :z, Float, description: "Depth. Persisted from the start; used for stacking order by the 2.5D renderer."
  end
end
