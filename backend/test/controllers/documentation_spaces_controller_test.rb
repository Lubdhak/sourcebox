# frozen_string_literal: true

require "test_helper"

class DocumentationSpacesControllerTest < ActionDispatch::IntegrationTest
  include Devise::Test::IntegrationHelpers

  setup do
    @user = create_user
    @space = create_space(user: @user, name: "Platform")
    @layer = create_layer(space: @space, index: 0, name: "System")
    @node = create_node(space: @space, title: "API Gateway", layer: @layer, x: 10, y: 20)
    @other = create_node(space: @space, title: "Order Service", x: 300, y: 20)
    create_relationship(source: @node, target: @other, relationship_type: "calls")
  end

  test "requires authentication" do
    get documentation_spaces_path

    assert_redirected_to new_user_session_path
  end

  test "index lists the caller's spaces with their counts" do
    create_space(user: create_user, name: "Someone else's")
    sign_in @user

    get documentation_spaces_path

    assert_response :success
    spaces = inertia_props.fetch("spaces")

    assert_equal [ "Platform" ], spaces.map { |space| space["name"] }
    assert_equal 2, spaces.first["nodeCount"]
    assert_equal 1, spaces.first["relationshipCount"]
  end

  test "show serializes the graph in the same shape GraphQL returns" do
    # The two sources have to agree exactly. The canvas renders from the Inertia props on
    # first paint and from GraphQL after, so any difference in casing or nesting would
    # surface as a bug only after the first refetch.
    sign_in @user

    get documentation_space_path(@space.public_id)

    assert_response :success
    props = inertia_props

    assert_equal @space.public_id, props.dig("space", "id")
    assert_equal [ "System" ], props.dig("space", "layers").map { |layer| layer["name"] }

    node = props.dig("initialGraph", "nodes").find { |candidate| candidate["title"] == "API Gateway" }
    assert_equal({ "x" => 10.0, "y" => 20.0, "z" => 0.0 }, node["position"])
    assert_equal({ "width" => 240.0, "height" => 120.0, "depth" => 0.0 }, node["size"])
    assert_equal @layer.id.to_s, node["layerId"]
    assert_equal "service", node["nodeType"]

    relationship = props.dig("initialGraph", "relationships").first
    assert_equal "calls", relationship["relationshipType"]
    assert_equal @node.id.to_s, relationship["sourceNodeId"]

    assert_equal 2, props.dig("initialGraph", "nodeCount")
    assert_not props.dig("initialGraph", "truncated")
  end

  test "show omits content blocks so first paint does not scale with how much is written" do
    create_block(node: @node, block_type: "markdown", data: { "markdown" => "# Gateway" })
    sign_in @user

    get documentation_space_path(@space.public_id)

    node = inertia_props.dig("initialGraph", "nodes").first
    assert_not node.key?("contentBlocks")
  end

  test "show sends the server-owned vocabularies" do
    sign_in @user

    get documentation_space_path(@space.public_id)

    props = inertia_props

    assert_includes props.fetch("nodeTypes"), "service"
    assert_includes props.fetch("relationshipTypes"), "depends_on"
    assert_includes props.fetch("blockTypes"), "MARKDOWN"
  end

  test "another user's space redirects rather than revealing that it exists" do
    sign_in create_user

    get documentation_space_path(@space.public_id)

    assert_redirected_to documentation_spaces_path
  end

  test "a space that does not exist behaves identically" do
    sign_in @user

    get documentation_space_path(SecureRandom.uuid)

    assert_redirected_to documentation_spaces_path
  end

  private

  # Inertia serializes the initial page into a JSON script element next to the root div
  # (`use_script_element_for_initial_page`). Reading it is how a request test inspects
  # props without a JavaScript runtime.
  def inertia_props
    page = Nokogiri::HTML(response.body)
    payload = page.at_css('script[type="application/json"][data-page="app"]')&.text

    assert payload.present?, "No Inertia page payload in the response"

    JSON.parse(payload).fetch("props")
  end
end
