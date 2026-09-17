# frozen_string_literal: true

module Types
  # Exposed as `ViewportInput`.
  #
  # The rectangle the user can actually see, in graph coordinates. Sending it lets the
  # server return the hundred nodes on screen instead of the ten thousand in the space --
  # the composite index on (documentation_space_id, x, y) is there for exactly this query.
  class ViewportInputType < Types::BaseInputObject
    graphql_name "ViewportInput"
    description "A rectangle in graph coordinates, used to load only what is visible."

    argument :min_x, Float, description: "Left edge."
    argument :min_y, Float, description: "Top edge."
    argument :max_x, Float, description: "Right edge."
    argument :max_y, Float, description: "Bottom edge."
  end
end
