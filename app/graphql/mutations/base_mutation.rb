# frozen_string_literal: true

module Mutations
  class BaseMutation < GraphQL::Schema::RelayClassicMutation
    include ApplicationGraphql::Authorization

    argument_class Types::BaseArgument
    field_class Types::BaseField
    input_object_class Types::BaseInputObject
    object_class Types::BaseObject

    # Every mutation requires a session. Overriding `ready?` means the check runs before
    # arguments are loaded and before `resolve` executes, so an unauthenticated request
    # never touches the database.
    def ready?(**args)
      require_authentication!

      super
    end

    private

    # Turns model validation failures into a structured GraphQL error instead of letting
    # an ActiveRecord::RecordInvalid escape as an internal error.
    def validation_error!(record)
      raise ApplicationGraphql::ValidationError.new(
        record.errors.full_messages.to_sentence,
        fields: record.errors.to_hash.transform_values { |messages| messages.map(&:to_s) }
      )
    end
  end
end
