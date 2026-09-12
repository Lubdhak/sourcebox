# frozen_string_literal: true

module Types
  # Exposed as `DashboardUiStateInput`.
  #
  # Every field is optional so the mutation can be a partial update: the client sends only
  # what changed, which is what makes an optimistic UI toggle cheap.
  #
  # The typed fields mirror DashboardUiStateType. Note the asymmetry with the output type:
  # inputs are where untrusted data enters, so this is exactly where strong typing pays
  # off. `theme` and `layout` are enums, so an invalid value is rejected during query
  # validation with a precise message, before any application code runs.
  class DashboardUiStateInputType < Types::BaseInputObject
    description "Partial update to a dashboard's view state. Omitted fields are left unchanged."

    argument :theme, Types::ThemeType,
             required: false,
             description: "Colour scheme preference."

    argument :layout, Types::LayoutType,
             required: false,
             description: "Widget arrangement."

    argument :visible_widgets, [ String ],
             required: false,
             description: "Identifiers of widgets to show, in display order."

    argument :widget_settings, GraphQL::Types::JSON,
             required: false,
             description: <<~DESC
               Per-widget settings, keyed by widget identifier.

               The one genuinely dynamic part of the state. Merged key-by-key rather than
               replaced wholesale, and bounded server-side by key count and byte size.
             DESC
  end
end
