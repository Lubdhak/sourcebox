# frozen_string_literal: true

module Documentation
  # Creates a new documentation space.
  class CreateSpace < Operation
    def initialize(user:, name:, description: nil, settings: {}, **options)
      super(actor: options.fetch(:actor, user), request_id: options[:request_id])

      @user = user
      @name = name
      @description = description
      @settings = settings || {}
    end

    def call
      space = DocumentationSpace.create!(
        user: @user,
        name: @name,
        description: @description,
        settings: @settings
      )

      publish(
        Events::Names::DOCUMENTATION_SPACE_CREATED,
        space_id: space.id
      )

      space
    end
  end
end
