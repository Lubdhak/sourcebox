# frozen_string_literal: true

require "test_helper"

# The access rule itself, tested directly rather than only through GraphQL.
#
# Everything in the application asks `permits?`, so if this file is right and every
# caller goes through it, the boundary holds. The GraphQL and controller tests then check
# that the callers do in fact go through it.
class DocumentationSpaceAccessTest < ActiveSupport::TestCase
  setup do
    @owner = create_user
    @space = create_space(user: @owner)
    @stranger = create_user
  end

  test "the owner may do everything, including what no membership can grant" do
    assert_equal "owner", @space.role_for(@owner)

    %i[read write admin].each do |action|
      assert @space.permits?(@owner, action), "owner should be permitted to #{action}"
    end
  end

  test "someone with no membership has no role and no access" do
    assert_nil @space.role_for(@stranger)
    assert_not @space.permits?(@stranger, :read)
  end

  test "an anonymous request has no access" do
    assert_nil @space.role_for(nil)
    assert_not @space.permits?(nil, :read)
  end

  test "each role permits exactly what it says" do
    expectations = {
      "viewer" => { read: true, write: false, admin: false },
      "editor" => { read: true, write: true, admin: false },
      "admin" => { read: true, write: true, admin: true },
    }

    expectations.each do |role, permissions|
      member = create_user
      share(space: @space, user: member, role: role)

      permissions.each do |action, allowed|
        assert_equal allowed, @space.permits?(member, action),
                     "#{role} should #{'not ' unless allowed}be permitted to #{action}"
      end
    end
  end

  test "an unclaimed invitation grants nothing yet" do
    invite(space: @space, email: "ada@example.com", role: "editor")
    ada = create_user(email: "ada@example.com")

    # The row exists, but it names an address rather than this account until it is
    # claimed. Treating it as access would mean anyone who could guess an invited
    # address could take the grant by signing up with it -- which is exactly what
    # claiming at sign-in verifies.
    assert_nil @space.role_for(ada)
  end

  test "accessible_by returns owned and shared spaces and nothing else" do
    shared = create_space(user: create_user)
    share(space: shared, user: @owner, role: "viewer")
    create_space(user: create_user)

    assert_equal [ @space.id, shared.id ].sort,
                 DocumentationSpace.accessible_by(@owner).pluck(:id).sort
  end

  test "revoking access removes it immediately" do
    member = create_user
    membership = share(space: @space, user: member, role: "editor")

    membership.destroy

    assert_nil @space.reload.role_for(member)
  end
end
