# frozen_string_literal: true

require "test_helper"

class SpaceMembershipTest < ActiveSupport::TestCase
  setup do
    @owner = create_user(email: "owner@example.com")
    @space = create_space(user: @owner, name: "Payments")
  end

  test "a membership names either a user or an invited address, never both or neither" do
    both = SpaceMembership.new(
      documentation_space: @space, user: create_user, invited_email: "a@example.com", role: "viewer"
    )
    neither = SpaceMembership.new(documentation_space: @space, role: "viewer")

    assert_not both.valid?
    assert_not neither.valid?
  end

  test "invited addresses are stored lowercased so a re-invite finds the existing row" do
    membership = invite(space: @space, email: "  Ada@Example.COM ")

    assert_equal "ada@example.com", membership.invited_email
  end

  test "roles are ordered by what they permit" do
    assert SpaceMembership.allows?("admin", "editor")
    assert SpaceMembership.allows?("editor", "editor")
    assert_not SpaceMembership.allows?("viewer", "editor")
    assert_not SpaceMembership.allows?("editor", "admin")

    # Owner is not a membership role, but it has to compare as the highest one: every
    # check in the app runs the owner through the same scale.
    assert SpaceMembership.allows?("owner", "admin")
  end

  test "signing in claims every invitation sent to that address" do
    invite(space: @space, email: "ada@example.com", role: "editor")
    second = create_space(user: @owner, name: "Ledger")
    invite(space: second, email: "ADA@example.com", role: "viewer")

    ada = create_user(email: "ada@example.com")

    assert_equal 2, SpaceMembership.claim_all_for(ada)

    claimed = SpaceMembership.where(user: ada)
    assert_equal 2, claimed.count
    assert claimed.all? { |row| row.invited_email.nil? && row.accepted_at.present? }
    assert_equal "editor", @space.role_for(ada)
  end

  test "an invitation to someone who already has access does not change their role" do
    ada = create_user(email: "ada@example.com")
    share(space: @space, user: ada, role: "admin")
    invite(space: @space, email: "ada@example.com", role: "viewer")

    SpaceMembership.claim_all_for(ada)

    # The deliberate grant wins over the stale invitation, and the invitation is cleared
    # rather than left to be claimed again at the next sign-in.
    assert_equal "admin", @space.role_for(ada)
    assert_equal 1, @space.space_memberships.count
  end

  test "claiming is a no-op for a user with no invitations" do
    assert_equal 0, SpaceMembership.claim_all_for(create_user)
  end
end
