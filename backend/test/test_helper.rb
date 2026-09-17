ENV["RAILS_ENV"] ||= "test"
require_relative "../config/environment"
require "rails/test_help"

require_relative "support/documentation_factories"
require_relative "support/graphql_helpers"

module ActiveSupport
  class TestCase
    # Run tests in parallel with specified workers
    parallelize(workers: :number_of_processors)

    # Setup all fixtures in test/fixtures/*.yml for all tests in alphabetical order.
    fixtures :all

    # Builders rather than YAML fixtures for the documentation domain.
    #
    # Fixtures are inserted straight into the database with validations and callbacks
    # skipped, which is the wrong tool for a domain whose invariants -- an edge cannot
    # span two spaces, a block's payload must match its type -- live in those validations.
    # A fixture that violates one would load happily and make the test that relies on it
    # meaningless.
    include DocumentationFactories
    include GraphqlHelpers
  end
end
