# frozen_string_literal: true

module Documentation
  # Persists new positions for one or more nodes.
  #
  # Movement has its own operation because it has its own shape. A drag gesture produces a
  # stream of positions for however many nodes are selected, the client has already
  # applied them optimistically, and the only thing the server owes it is that the numbers
  # are stored. So this writes coordinates and nothing else, in one statement, without
  # instantiating or validating the rest of each node.
  #
  # Skipping ActiveRecord validation is the reason the bounds check below exists: it is
  # the same rule Node validates, applied here because `update_all` does not run
  # callbacks or validations.
  class MoveNodes < Operation
    # A drag can select many nodes, but a single request moving more than this is a
    # client bug or an attempt to make one mutation arbitrarily expensive.
    MAX_NODES_PER_MOVE = 500

    def initialize(space:, positions:, **options)
      super(**options)

      @space = space
      @positions = Array(positions).map { |position| position.to_h.symbolize_keys }
    end

    def call
      return [] if @positions.empty?

      if @positions.size > MAX_NODES_PER_MOVE
        raise ApplicationGraphql::ValidationError,
              "A single move may not exceed #{MAX_NODES_PER_MOVE} nodes."
      end

      rows = coerce_rows

      # Scoped to the space, so an id belonging to another user's space simply is not
      # found and is silently dropped rather than moved. Authorization already covered the
      # space itself; this is what stops one authorized space from being used to write
      # into another.
      known_ids = @space.nodes.where(id: rows.map { |row| row[:id] }).pluck(:id).to_set
      rows.select! { |row| known_ids.include?(row[:id]) }

      return [] if rows.empty?

      apply(rows)

      publish(
        Events::Names::DOCUMENTATION_NODE_MOVED,
        space_id: @space.id,
        node_ids: rows.map { |row| row[:id] },
        node_count: rows.size
      )

      @space.nodes.where(id: rows.map { |row| row[:id] }).to_a
    end

    private

    # Every value passes through Integer() or Float() here, which is what makes the
    # interpolated VALUES list below safe: by the time it is built, nothing in it came
    # from the request as a string.
    def coerce_rows
      @positions.map do |position|
        {
          id: Integer(position.fetch(:id)),
          x: bounded(position.fetch(:x), :x),
          y: bounded(position.fetch(:y), :y),
          z: bounded(position.fetch(:z, 0.0), :z),
        }
      end
    rescue TypeError, ArgumentError, KeyError
      raise ApplicationGraphql::ValidationError,
            "Each position must supply a node id and numeric x and y coordinates."
    end

    def bounded(value, axis)
      coordinate = Float(value)

      unless coordinate.finite? && coordinate.abs <= Node::COORDINATE_LIMIT
        raise ApplicationGraphql::ValidationError,
              "#{axis} must be between -#{Node::COORDINATE_LIMIT.to_i} and #{Node::COORDINATE_LIMIT.to_i}."
      end

      coordinate
    end

    # One statement for the whole batch.
    #
    # `update_all` per node would be correct and would also mean fifty round trips for a
    # fifty-node drag, at the frequency a drag produces them. A VALUES join does it once.
    def apply(rows)
      tuples = rows.map do |row|
        "(#{row[:id]}::bigint, #{row[:x]}::double precision, " \
          "#{row[:y]}::double precision, #{row[:z]}::double precision)"
      end

      ActiveRecord::Base.connection.update(<<~SQL.squish)
        UPDATE nodes
        SET x = v.x, y = v.y, z = v.z, updated_at = CURRENT_TIMESTAMP
        FROM (VALUES #{tuples.join(', ')}) AS v(id, x, y, z)
        WHERE nodes.id = v.id
          AND nodes.documentation_space_id = #{Integer(@space.id)}
      SQL
    end
  end
end
