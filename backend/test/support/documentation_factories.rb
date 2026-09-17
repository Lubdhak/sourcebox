# frozen_string_literal: true

# Builders for the documentation domain.
#
# Every one goes through the model, so a test can never set up a state the application
# would refuse to create. Defaults are chosen so that a test states only what it is about:
# a relationship test says which two nodes, not what they are titled.
module DocumentationFactories
  def create_user(email: nil, password: "correct horse battery staple")
    User.create!(email: email || "user-#{SecureRandom.hex(6)}@example.com", password: password)
  end

  def create_space(user: nil, name: nil, **attributes)
    DocumentationSpace.create!(
      user: user || create_user,
      name: name || "Space #{SecureRandom.hex(4)}",
      **attributes
    )
  end

  # Access, as it exists after an invitation has been claimed. Tests that care about the
  # unclaimed half say so explicitly with `invite`.
  def share(space:, user:, role: "editor", invited_by: nil)
    space.space_memberships.create!(
      user: user,
      role: role,
      invited_by: invited_by || space.user,
      accepted_at: Time.current
    )
  end

  def invite(space:, email:, role: "viewer", invited_by: nil)
    space.space_memberships.create!(
      invited_email: email,
      role: role,
      invited_by: invited_by || space.user
    )
  end

  def create_layer(space:, index: 0, name: "System", **attributes)
    space.layers.create!(index: index, name: name, **attributes)
  end

  def create_node(space:, title: nil, **attributes)
    space.nodes.create!(
      title: title || "Node #{SecureRandom.hex(4)}",
      node_type: attributes.delete(:node_type) || "service",
      **attributes
    )
  end

  def create_relationship(source:, target:, relationship_type: "calls", **attributes)
    NodeRelationship.create!(
      documentation_space: source.documentation_space,
      source_node: source,
      target_node: target,
      relationship_type: relationship_type,
      **attributes
    )
  end

  def create_block(node:, block_type: "text", data: nil, position: nil)
    node.content_blocks.create!(
      block_type: block_type,
      data: data || default_block_data(block_type),
      position: position || (node.content_blocks.maximum(:position) || -1) + 1
    )
  end

  private

  def default_block_data(block_type)
    case block_type
    when "text"     then { "text" => "Some prose." }
    when "markdown" then { "markdown" => "## Heading" }
    when "code"     then { "code" => "puts 1", "language" => "ruby" }
    when "json"     then { "value" => { "key" => "value" } }
    when "table"    then { "columns" => [ "a" ], "rows" => [ [ 1 ] ] }
    when "url"      then { "url" => "https://example.com" }
    else { "text" => "Some prose." }
    end
  end
end
