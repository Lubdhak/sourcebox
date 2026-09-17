# frozen_string_literal: true

# A typed piece of content inside a node.
#
# One table serves every block type. The alternative -- a model and a table per type --
# buys column-level typing for payloads the renderer has to branch on anyway, and charges
# a migration for every new block type plus an n-way union on every read. So the type is a
# column, the payload is JSONB, and the shape of the payload is validated here, per type.
#
# Adding a block type is one entry in SHAPES plus one React component. Nothing else in the
# backend changes.
class ContentBlock < ApplicationRecord
  belongs_to :node

  # Declarative per-type payload shapes.
  #
  # `required` keys must be present and of the stated kind; `optional` keys are checked
  # only when present. Anything not listed is allowed through: block payloads carry
  # renderer hints that the server has no opinion about, and rejecting unknown keys would
  # make every frontend addition a backend deploy.
  #
  # Keys are camelCase because that is how JSONB documents are stored throughout this
  # application (see dashboards.ui_state) and it is the shape the client sends.
  SHAPES = {
    "text"     => { required: { "text" => :string }, optional: {} },
    "markdown" => { required: { "markdown" => :string }, optional: {} },
    # The payload is wrapped in `value` rather than stored bare, so that a JSON block can
    # hold an array or a scalar while the column keeps its "always an object" constraint.
    "json"     => { required: { "value" => :any }, optional: {} },
    "table"    => { required: { "columns" => :array, "rows" => :array }, optional: {} },
    "image"    => { required: { "url" => :string }, optional: { "alt" => :string, "caption" => :string } },
    "video"    => { required: { "url" => :string }, optional: { "caption" => :string } },
    "audio"    => { required: { "url" => :string }, optional: { "caption" => :string } },
    "url"      => { required: { "url" => :string }, optional: { "label" => :string, "kind" => :string } },
    "dropdown" => { required: { "options" => :array }, optional: { "label" => :string, "defaultValue" => :string } },
    "code"     => { required: { "code" => :string }, optional: { "language" => :string } },
    "diagram"  => { required: { "source" => :string }, optional: { "format" => :string } },
    "embed"    => { required: { "url" => :string }, optional: { "title" => :string } },
    # The block form of a graph edge: it renders as a link into another node's
    # documentation without duplicating that node's content.
    "node_reference" => { required: { "nodeId" => :string }, optional: { "label" => :string } },
  }.freeze

  TYPES = SHAPES.keys.freeze

  # Every block may carry a heading, independent of its type.
  COMMON_OPTIONAL_KEYS = { "title" => :string }.freeze

  # Bounds on the payload. A block is edited from a textarea, so without a cap this is a
  # path for pushing megabytes into a row on every keystroke.
  MAX_SERIALIZED_DATA_BYTES = 256.kilobytes
  MAX_TABLE_COLUMNS = 50
  MAX_TABLE_ROWS = 5_000
  MAX_DROPDOWN_OPTIONS = 200

  # Used by the reorder operation to move rows out of the way of the unique index on
  # (node_id, position) without ever going negative, which the CHECK constraint forbids.
  POSITION_STAGING_OFFSET = 1_000_000

  validates :block_type, presence: true, inclusion: {
    in: TYPES,
    message: "is not a supported block type",
  }
  validates :position, presence: true,
                       numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :data_must_be_a_bounded_object
  validate :data_must_match_the_block_type_shape

  scope :ordered, -> { order(:position) }

  scope :matching, ->(query) {
    where("search_vector @@ websearch_to_tsquery('english', ?)", query)
  }

  # A short, plain-text rendering of the payload, for search results and list views where
  # the real renderer is not available. Each type answers it differently, which is exactly
  # the branching that keeps the renderer out of the Node component on the frontend.
  def preview(limit: 160)
    text = case block_type
           when "text"           then data["text"]
           when "markdown"       then data["markdown"]
           when "code"           then data["code"]
           when "diagram"        then data["source"]
           when "json"           then data["value"].to_json
           when "table"          then Array(data["columns"]).join(" · ")
           when "url", "embed", "image", "video", "audio" then data["label"].presence || data["url"]
           when "dropdown"       then Array(data["options"]).filter_map { |o| o.is_a?(Hash) ? o["label"] : nil }.join(" · ")
           when "node_reference" then data["label"]
           end

    text.to_s.squish.truncate(limit)
  end

  private

  def data_must_be_a_bounded_object
    unless data.is_a?(Hash)
      errors.add(:data, "must be a JSON object")
      return
    end

    if data.to_json.bytesize > MAX_SERIALIZED_DATA_BYTES
      errors.add(:data, "exceeds #{MAX_SERIALIZED_DATA_BYTES / 1024}KB")
    end
  end

  def data_must_match_the_block_type_shape
    return unless data.is_a?(Hash)

    shape = SHAPES[block_type]
    return if shape.nil? # An unsupported type is already reported by the inclusion validation.

    shape[:required].each do |key, kind|
      if !data.key?(key) || (kind != :any && data[key].nil?)
        errors.add(:data, "must include #{key}")
      elsif !matches_kind?(data[key], kind)
        errors.add(:data, "#{key} must be #{kind}")
      end
    end

    shape[:optional].merge(COMMON_OPTIONAL_KEYS).each do |key, kind|
      next unless data.key?(key) && !data[key].nil?

      errors.add(:data, "#{key} must be #{kind}") unless matches_kind?(data[key], kind)
    end

    validate_collection_limits
  end

  def matches_kind?(value, kind)
    case kind
    when :any     then true
    when :string  then value.is_a?(String)
    when :array   then value.is_a?(Array)
    when :object  then value.is_a?(Hash)
    when :number  then value.is_a?(Numeric)
    when :boolean then value == true || value == false
    else false
    end
  end

  # Shape alone does not bound cost: a table is a legal array of arrays at any size, and
  # the renderer has to draw it.
  def validate_collection_limits
    case block_type
    when "table"
      errors.add(:data, "may not exceed #{MAX_TABLE_COLUMNS} columns") if Array(data["columns"]).size > MAX_TABLE_COLUMNS
      errors.add(:data, "may not exceed #{MAX_TABLE_ROWS} rows") if Array(data["rows"]).size > MAX_TABLE_ROWS
      errors.add(:data, "rows must be arrays") if Array(data["rows"]).any? { |row| !row.is_a?(Array) }
    when "dropdown"
      options = Array(data["options"])
      errors.add(:data, "may not exceed #{MAX_DROPDOWN_OPTIONS} options") if options.size > MAX_DROPDOWN_OPTIONS
      unless options.all? { |option| option.is_a?(Hash) && option["label"].is_a?(String) }
        errors.add(:data, "options must each be an object with a label")
      end
    end
  end
end
