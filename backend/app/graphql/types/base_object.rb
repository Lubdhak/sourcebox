# frozen_string_literal: true

module Types
  class BaseObject < GraphQL::Schema::Object
    include ApplicationGraphql::Authorization

    field_class Types::BaseField

    # Connections use our BaseConnection so every paginated field gets the same
    # PageInfo type and totalCount behaviour.
    #
    # BaseConnection intentionally descends from GraphQL::Types::Relay::BaseConnection
    # rather than from this class: having it inherit BaseObject while BaseObject
    # references it creates a circular autoload.
    connection_type_class Types::BaseConnection

    # Batch a belongs_to id into a single query. See Loaders::RecordLoader.
    def load_record(model, id, column: model.primary_key)
      return nil if id.blank?

      dataloader.with(Loaders::RecordLoader, model, column: column).load(id)
    end

    # Batch an association across sibling parents. See Loaders::AssociationLoader.
    def load_association(model, association_name, record = object)
      dataloader.with(Loaders::AssociationLoader, model, association_name).load(record)
    end
  end
end
