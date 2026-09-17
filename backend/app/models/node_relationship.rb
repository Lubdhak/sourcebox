# frozen_string_literal: true

# A directed, typed edge between two nodes.
#
# This is why the domain is a graph and not a tree. `contains` gives the familiar
# parent/child reading, but it is just one relationship type among many: the same node can
# be contained by one system, depended on by another, and referenced from a third, without
# its content existing in more than one place.
class NodeRelationship < ApplicationRecord
  belongs_to :documentation_space
  belongs_to :source_node, class_name: "Node"
  belongs_to :target_node, class_name: "Node"

  # The starting vocabulary. Not validated as an inclusion list: a team documenting its
  # own system needs its own verbs (`deploys_to`, `owned_by`, `mitigates`) and should not
  # need a migration or a deploy to add one.
  SUGGESTED_TYPES = %w[
    contains depends_on calls reads_from writes_to
    publishes_to subscribes_to references related_to
  ].freeze

  # `contains` is the hierarchical relationship. Layout and tree views single it out; the
  # storage does not.
  HIERARCHICAL_TYPE = "contains"

  MAX_SERIALIZED_METADATA_BYTES = 8.kilobytes

  validates :relationship_type,
            presence: true,
            length: { maximum: 60 },
            format: {
              with: /\A[a-z][a-z0-9_]*\z/,
              message: "may only contain lowercase letters, numbers and underscores",
            }
  validates :source_node_id, uniqueness: {
    scope: [ :target_node_id, :relationship_type ],
    message: "already has a relationship of this type to that node",
  }
  validate :must_not_be_self_referential
  validate :endpoints_must_share_the_space
  validate :metadata_must_be_a_bounded_object

  before_validation :inherit_space_from_source, if: -> { documentation_space_id.blank? }

  scope :for_nodes, ->(node_ids) {
    where(source_node_id: node_ids).or(where(target_node_id: node_ids))
  }

  private

  def inherit_space_from_source
    self.documentation_space_id = source_node&.documentation_space_id
  end

  # Also a CHECK constraint. Validated here too so the user gets a field error instead of
  # a 500 from a constraint violation.
  def must_not_be_self_referential
    return if source_node_id.blank? || source_node_id != target_node_id

    errors.add(:target_node, "must be a different node")
  end

  # The integrity rule a foreign key cannot express, and the one that matters most: an
  # edge spanning two spaces would leak one tenant's node into another's canvas, because
  # authorization is checked at the space and edges are loaded by space.
  def endpoints_must_share_the_space
    return if source_node.blank? || target_node.blank?

    unless source_node.documentation_space_id == target_node.documentation_space_id
      errors.add(:target_node, "must belong to the same documentation space as the source")
      return
    end

    return if documentation_space_id == source_node.documentation_space_id

    errors.add(:documentation_space, "must match the space of both endpoints")
  end

  def metadata_must_be_a_bounded_object
    unless metadata.is_a?(Hash)
      errors.add(:metadata, "must be a JSON object")
      return
    end

    if metadata.to_json.bytesize > MAX_SERIALIZED_METADATA_BYTES
      errors.add(:metadata, "exceeds #{MAX_SERIALIZED_METADATA_BYTES / 1024}KB")
    end
  end
end
