# frozen_string_literal: true

module Types
  # Exposed as the `Theme` enum.
  #
  # An enum rather than a String: the set of themes is closed and server-owned, so the
  # schema should reject an invalid value at validation time instead of letting it reach
  # a model validation -- and the generated TypeScript becomes a union rather than
  # `string`.
  class ThemeType < Types::BaseEnum
    description "Colour scheme preference for a dashboard."

    # Values are derived from the model so the enum and the validation can never
    # disagree.
    Dashboard::THEMES.each do |theme|
      value theme.upcase, value: theme, description: "The #{theme} theme."
    end
  end
end
