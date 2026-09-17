# frozen_string_literal: true

module Documentation
  # Renames a rung, or describes it.
  #
  # Deliberately not a way to change `index`. Moving a layer up or down the ladder is a
  # reordering of the whole ladder, not an edit of one row, and giving it the same entry
  # point as a rename would make a one-field form capable of silently re-indexing four
  # other layers. ReorderLayers owns that.
  class UpdateLayer < Operation
    ASSIGNABLE = %i[name description].freeze

    def initialize(layer:, **attributes)
      super(**attributes.except(*ASSIGNABLE))

      @layer = layer
      @attributes = attributes.slice(*ASSIGNABLE)
    end

    def call
      @attributes.each { |key, value| @layer.public_send("#{key}=", value) }

      # Nothing to report if nothing moved: an idempotent save from a form that was opened
      # and closed should not enqueue a job.
      return @layer unless @layer.changed?

      changed = @layer.changed
      @layer.save!

      publish(
        Events::Names::DOCUMENTATION_LAYER_UPDATED,
        space_id: @layer.documentation_space_id,
        layer_id: @layer.id,
        changed: changed
      )

      @layer
    end
  end
end
