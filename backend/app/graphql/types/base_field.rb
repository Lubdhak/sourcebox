# frozen_string_literal: true

module Types
  class BaseField < GraphQL::Schema::Field
    argument_class Types::BaseArgument

    # Fields are non-null by default in this schema.
    #
    # graphql-ruby defaults to nullable, which is the safer choice for a public API that
    # evolves independently of its clients. Here the client is versioned together with
    # the server, so defaulting to non-null gives the TypeScript side far fewer
    # meaningless null checks. Nullability is still explicit wherever a field genuinely
    # can be absent.
    def initialize(*args, null: false, **kwargs, &block)
      super(*args, null: null, **kwargs, &block)
    end
  end
end
