# frozen_string_literal: true

module Types
  # Exposed as the `Layout` enum.
  class LayoutType < Types::BaseEnum
    description "Arrangement of widgets on a dashboard."

    Dashboard::LAYOUTS.each do |layout|
      value layout.upcase, value: layout, description: "The #{layout} layout."
    end
  end
end
