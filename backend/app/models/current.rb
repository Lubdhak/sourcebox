# frozen_string_literal: true

# Request-scoped correlation state.
#
# This is what lets a single `request_id` follow a request through the GraphQL
# mutation that started it, the Rails.event it emits, and the Solid Queue job that
# event fans out to. ActiveSupport::CurrentAttributes resets automatically between
# requests and between job executions, so values never leak across them.
class Current < ActiveSupport::CurrentAttributes
  attribute :request_id
  attribute :user_id
end
