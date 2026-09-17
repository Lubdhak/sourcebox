# frozen_string_literal: true

module Types
  # Exposed as `Layer`.
  class LayerType < Types::BaseObject
    description <<~DESC
      A conceptual depth within a space: System, Services, Modules, and so on.

      Not the graph hierarchy. A node on the Details layer may relate to a node on the
      System layer; a layer is a filtering and zoom dimension, nothing more.
    DESC

    field :id, ID
    field :index, Integer, description: "Conceptual depth, 0-based. Unique within a space."
    field :name, String
    field :description, String, null: true
    field :node_count, Integer, description: "How many nodes currently sit on this layer."

    def id
      object.id.to_s
    end

    # Batched: rendering the layer filter for five layers issues one nodes query, not
    # five counts.
    def node_count
      load_association(Layer, :nodes).size
    end
  end
end
