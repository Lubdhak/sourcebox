# frozen_string_literal: true

module Types
  # Exposed as `DashboardUiState`.
  #
  # This type is the answer to "GraphQL::Types::JSON or strongly typed fields?".
  #
  # The stable parts of the UI state -- theme, layout, which widgets are visible -- are
  # strongly typed. They have a known shape, the server validates them, and the frontend
  # gets real types and autocompletion for them.
  #
  # Only `widgetSettings` is a JSON scalar, because it is genuinely open-ended: each
  # widget stores its own settings and the server has no opinion about their shape.
  #
  # Typing everything as JSON would have been less code and much worse: no schema
  # validation, no introspection, no generated TypeScript, and no way to evolve a field
  # without guessing what clients send. Reserve the JSON escape hatch for data that is
  # actually dynamic.
  class DashboardUiStateType < Types::BaseObject
    description "Client-owned view state for a dashboard."

    field :theme, Types::ThemeType,
          description: "Colour scheme preference."

    field :layout, Types::LayoutType,
          description: "Widget arrangement."

    field :visible_widgets, [ String ],
          description: "Identifiers of the widgets currently shown, in display order."

    field :widget_settings, GraphQL::Types::JSON,
          description: <<~DESC
            Per-widget settings, keyed by widget identifier.

            Deliberately untyped: each widget owns its own settings shape. Server-side
            this is size- and key-count-limited rather than schema-validated, so treat it
            as untrusted input on the client too.
          DESC

    def theme
      object.theme
    end

    def layout
      object.layout
    end

    def visible_widgets
      object.visible_widgets
    end

    def widget_settings
      object.widget_settings
    end
  end
end
