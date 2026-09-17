# frozen_string_literal: true

require "test_helper"

class DocumentationSpaceTest < ActiveSupport::TestCase
  test "derives a slug from the name" do
    space = create_space(name: "E-commerce Platform")

    assert_equal "e-commerce-platform", space.slug
  end

  test "slugs are unique per owner, and the same slug may exist for two users" do
    owner = create_user

    first = create_space(user: owner, name: "Payments")
    second = create_space(user: owner, name: "Payments")
    other_user = create_space(user: create_user, name: "Payments")

    assert_equal "payments", first.slug
    assert_equal "payments-2", second.slug, "A second space with the same name should not collide"
    assert_equal "payments", other_user.slug, "Slugs are scoped to the owner, not global"
  end

  test "assigns a public id that is not the database id" do
    space = create_space

    assert_match(/\A[0-9a-f-]{36}\z/, space.public_id)
    assert_equal space.public_id, space.to_param
  end

  test "find_by_public_id returns nil for a malformed uuid rather than raising" do
    create_space

    # PostgreSQL rejects a malformed uuid literal outright. If that escaped as a 500, the
    # error itself would tell an attacker their input reached the database.
    assert_nil DocumentationSpace.find_by_public_id("not-a-uuid")
    assert_nil DocumentationSpace.find_by_public_id(nil)
  end

  test "rejects settings that are not an object" do
    space = build_space(settings: [ 1, 2 ])

    assert_not space.valid?
    assert_includes space.errors[:settings], "must be a JSON object"
  end

  test "rejects settings larger than the cap" do
    space = build_space(settings: { "blob" => "x" * (DocumentationSpace::MAX_SERIALIZED_SETTINGS_BYTES + 1) })

    assert_not space.valid?
    assert_match(/exceeds/, space.errors[:settings].first)
  end

  test "destroying a space destroys its whole graph" do
    space = create_space
    node = create_node(space: space)
    other = create_node(space: space)
    create_relationship(source: node, target: other)
    create_block(node: node)
    create_layer(space: space)

    assert_difference "Node.count", -2 do
      assert_difference [ "Layer.count", "NodeRelationship.count", "ContentBlock.count" ], -1 do
        space.destroy!
      end
    end
  end

  private

  def build_space(**attributes)
    DocumentationSpace.new(user: create_user, name: "Example", **attributes)
  end
end
