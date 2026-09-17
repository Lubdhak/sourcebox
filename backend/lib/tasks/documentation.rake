# frozen_string_literal: true

namespace :documentation do
  desc "Give a depth to nodes created before every node had one (pass SPACE=<public_id> for one space)"
  task assign_missing_depths: :environment do
    # A task rather than a migration, deliberately. It reads the containment graph and
    # writes derived data, which is application logic that will keep making sense long
    # after this schema version; a migration would freeze that logic into the schema's
    # history and run it exactly once, on a database whose spaces may not need it yet.
    scope = ENV["SPACE"].present? ? DocumentationSpace.where(public_id: ENV["SPACE"]) : DocumentationSpace.all

    scope.find_each do |space|
      result = Documentation::AssignMissingDepths.call(space: space)
      next if result.assigned.zero? && result.layers_created.zero?

      puts "#{space.slug}: #{result.assigned} nodes given a depth, #{result.layers_created} rungs created"
    end
  end
end
