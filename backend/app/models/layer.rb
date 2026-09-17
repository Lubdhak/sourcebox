# frozen_string_literal: true

# A conceptual depth within a space: System, Services, Modules, Implementation, Details.
#
# A layer is emphatically not the graph hierarchy. It is a filtering and zoom dimension:
# a node on the Details layer may relate to a node on the System layer, and both keep
# their layer. Treating the two as the same thing is what turns a graph back into a tree.
class Layer < ApplicationRecord
  belongs_to :documentation_space

  # Nullified rather than destroyed: deleting the "Modules" layer must not delete
  # everything documented at that depth.
  has_many :nodes, dependent: :nullify

  validates :name, presence: true, length: { maximum: 80 }
  # Depth is open-ended. There was a ceiling of 64 here, which was a guess dressed up as a
  # rule: a system decomposed far enough -- product, service, module, class, method,
  # branch -- runs out of it, and the only thing the ceiling bought was an error at the
  # exact moment someone was documenting in more detail than we imagined. The column is a
  # 4-byte integer and the index is unique per space; nothing else cares how deep the
  # ladder goes.
  validates :index, presence: true,
                    numericality: { only_integer: true, greater_than_or_equal_to: 0, less_than: 2_147_483_647 }
  validates :index, uniqueness: { scope: :documentation_space_id }
  validates :description, length: { maximum: 1_000 }, allow_blank: true

  scope :ordered, -> { order(:index) }
  scope :deeper_than, ->(index) { where(index: (index + 1)..).ordered }

  # The name a newly provisioned depth gets. Auto-created layers are named rather than
  # left blank so the ladder reads as something deliberate in the UI, and renaming one is
  # a normal edit.
  def self.default_name_for(index)
    "Depth #{index}"
  end

  # Nodes sit on exactly one layer, so "is this the deepest rung" is answered per space.
  def deepest?
    !documentation_space.layers.where(index: (index + 1)..).exists?
  end
end
