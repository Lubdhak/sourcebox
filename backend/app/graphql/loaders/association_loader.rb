# frozen_string_literal: true

module Loaders
  # Batches an ActiveRecord association across many parent records.
  #
  # `RecordLoader` batches lookups by key; this batches *associations*, which is what you
  # need for has_many / belongs_to traversal:
  #
  #   user(1).dashboards -.
  #   user(2).dashboards  |--> one preload for [user1, user2, user3]
  #   user(3).dashboards -'
  #
  # Usage from a type:
  #
  #   def dashboards
  #     dataloader.with(Loaders::AssociationLoader, User, :dashboards).load(object)
  #   end
  class AssociationLoader < GraphQL::Dataloader::Source
    def initialize(model, association_name)
      @model = model
      @association_name = association_name

      validate_association!

      super()
    end

    def fetch(records)
      # Delegates to Rails' own preloader, so the association's scopes, ordering and
      # polymorphism are honoured rather than reimplemented.
      ActiveRecord::Associations::Preloader.new(
        records: records,
        associations: @association_name
      ).call

      records.map { |record| record.public_send(@association_name) }
    end

    private

    # Fail at construction with a clear message rather than at fetch time with a
    # confusing preloader error.
    def validate_association!
      return if @model.reflect_on_association(@association_name)

      raise ArgumentError, "#{@model.name} has no association #{@association_name}"
    end
  end
end
