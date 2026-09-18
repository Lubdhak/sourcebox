# frozen_string_literal: true

class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :recoverable,
         :rememberable, :validatable, :trackable,
         :omniauthable, omniauth_providers: [ :google_oauth2 ]

  # Documentation ownership hangs off the existing account, and sharing hangs off
  # ownership: a space belongs to one user who cannot be removed from it, and everyone
  # else reaches it through a membership. Everything inside a space is authorized by
  # reaching that space first, so these two associations are the whole access model.
  has_many :documentation_spaces, dependent: :destroy
  has_many :space_memberships, dependent: :destroy
  has_many :shared_documentation_spaces, through: :space_memberships, source: :documentation_space

  # Spaces this user owns *or* has been given access to.
  def accessible_documentation_spaces
    DocumentationSpace.accessible_by(self)
  end

  validates :provider, presence: true, if: -> { uid.present? }
  validates :uid, presence: true, if: -> { provider.present? }

  # Emitted after commit, not after save, so a rolled-back transaction never
  # produces a welcome email or an analytics record for a user that does not exist.
  after_create_commit :report_created

  # Finds or provisions the local account for a Google identity.
  #
  # Three cases, in order:
  #   1. Known identity  -> refresh the mutable profile fields.
  #   2. Known email     -> link Google to the existing password account.
  #   3. Unknown         -> provision a new account.
  #
  # Case 2 is a deliberate trust decision: it is safe only because Google verifies
  # the email address it asserts. We check `email_verified` before linking, otherwise
  # an attacker who controls an unverified Google account bearing someone else's
  # address could take over that account.
  def self.from_google(auth)
    email = auth.info.email
    raise ArgumentError, "Google identity is missing an email address" if email.blank?

    attributes = {
      email: email,
      name: auth.info.name,
      avatar_url: auth.info.image,
    }

    if (user = find_by(provider: auth.provider, uid: auth.uid))
      user.update(attributes)
      return user
    end

    if google_verified_email?(auth) && (user = find_by(email: email))
      user.update(attributes.merge(provider: auth.provider, uid: auth.uid))
      return user
    end

    create!(
      attributes.merge(
        provider: auth.provider,
        uid: auth.uid,
        password: Devise.friendly_token(32)
      )
    )
  rescue ActiveRecord::RecordNotUnique
    # Two concurrent callbacks for the same new identity. The partial unique index on
    # (provider, uid) is what makes this a caught race rather than a duplicate account.
    find_by!(provider: auth.provider, uid: auth.uid)
  end

  def self.google_verified_email?(auth)
    verified = auth.info.email_verified
    verified = auth.extra&.raw_info&.email_verified if verified.nil?

    ActiveModel::Type::Boolean.new.cast(verified) == true
  end

  def display_name
    name.presence || email.split("@").first
  end

  private

  def report_created
    Rails.event.notify(
      Events::Names::USER_CREATED,
      user_id: id,
      provider: provider,
      request_id: Current.request_id
    )
  end
end
