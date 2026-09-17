# frozen_string_literal: true

module Documentation
  # Creates a space and the single depth it starts at.
  #
  # It used to be seeded with five named rungs -- System, Services, Modules,
  # Implementation, Details -- which was a guess about how someone else's system
  # decomposes, presented as though the tool already knew. Every new space opened
  # claiming four depths that did not exist yet and named them after a hierarchy the
  # author had not chosen.
  #
  # Depth now grows from use instead: one rung to start, and drilling into a node
  # provisions the next one when there is something to put on it (CreateNode#layer_below).
  # Those arrive called "Depth 3" and are renamed once the author knows what lives there,
  # which is the only moment anybody can answer that.
  class CreateSpace < Operation
    # Not named for a concept, because at this point there is no content to name it
    # after. The first thing anyone documents is the thing itself.
    ROOT_LAYER = { index: 0, name: "Overview", description: "Where the space starts." }.freeze

    def initialize(user:, name:, description: nil, settings: {}, create_default_layers: true, **options)
      super(actor: options.fetch(:actor, user), request_id: options[:request_id])

      @user = user
      @name = name
      @description = description
      @settings = settings || {}
      @create_default_layers = create_default_layers
    end

    def call
      space = ActiveRecord::Base.transaction do
        record = DocumentationSpace.create!(
          user: @user,
          name: @name,
          description: @description,
          settings: @settings
        )

        record.layers.create!(**ROOT_LAYER) if @create_default_layers

        record
      end

      publish(
        Events::Names::DOCUMENTATION_SPACE_CREATED,
        space_id: space.id,
        # The name is the user's own words about their own data, so it stays out of a
        # payload that is persisted as a job argument. The same rule the dashboard
        # mutation follows with `changed_keys`.
        layer_count: space.layers.size
      )

      space
    end
  end
end
