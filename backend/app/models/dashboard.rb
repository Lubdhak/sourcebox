# frozen_string_literal: true

class Dashboard < ApplicationRecord
  belongs_to :user

  # The JSONB boundary.
  #
  # `ui_state` holds client-owned view state. It is validated here, and again by a
  # CHECK constraint in the database, because it is the one place where arbitrary
  # client JSON reaches storage. Everything the server reasons about is a typed
  # GraphQL field; only genuinely open-ended per-widget settings live in the loose
  # part of this document.
  DEFAULT_UI_STATE = {
    "theme" => "system",
    "layout" => "grid",
    "visibleWidgets" => %w[revenue signups latency],
    "widgetSettings" => {},
  }.freeze

  THEMES  = %w[light dark system].freeze
  LAYOUTS = %w[grid list].freeze

  # Bounds on the dynamic portion. Without these, `widgetSettings` is an unbounded
  # write primitive: a client could push megabytes of JSON into a row on every
  # keystroke.
  MAX_WIDGET_SETTINGS_KEYS  = 50
  MAX_SERIALIZED_STATE_BYTES = 64.kilobytes

  # Seeded in Ruby rather than as a column default so the shape lives next to the
  # validations that enforce it. The column default stays `{}` so the NOT NULL
  # constraint holds even for rows written outside the model.
  after_initialize :apply_default_ui_state, if: :new_record?

  validates :ui_state, presence: true
  validate :ui_state_must_be_an_object
  validate :ui_state_must_be_within_limits
  validate :typed_ui_state_fields_must_be_valid

  def theme
    ui_state["theme"].presence || DEFAULT_UI_STATE["theme"]
  end

  def layout
    ui_state["layout"].presence || DEFAULT_UI_STATE["layout"]
  end

  def visible_widgets
    Array(ui_state["visibleWidgets"]).map(&:to_s)
  end

  def widget_settings
    ui_state["widgetSettings"].presence || {}
  end

  private

  def apply_default_ui_state
    return if ui_state.present?

    self.ui_state = DEFAULT_UI_STATE.deep_dup
  end

  def ui_state_must_be_an_object
    return if ui_state.is_a?(Hash)

    errors.add(:ui_state, "must be a JSON object")
  end

  def ui_state_must_be_within_limits
    return unless ui_state.is_a?(Hash)

    if widget_settings.size > MAX_WIDGET_SETTINGS_KEYS
      errors.add(:ui_state, "widgetSettings may not exceed #{MAX_WIDGET_SETTINGS_KEYS} keys")
    end

    if ui_state.to_json.bytesize > MAX_SERIALIZED_STATE_BYTES
      errors.add(:ui_state, "exceeds #{MAX_SERIALIZED_STATE_BYTES / 1024}KB")
    end
  end

  def typed_ui_state_fields_must_be_valid
    return unless ui_state.is_a?(Hash)

    errors.add(:ui_state, "theme must be one of #{THEMES.join(', ')}") unless THEMES.include?(theme)
    errors.add(:ui_state, "layout must be one of #{LAYOUTS.join(', ')}") unless LAYOUTS.include?(layout)
  end
end
