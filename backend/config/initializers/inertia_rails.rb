# frozen_string_literal: true

InertiaRails.configure do |config|
  # Opt in now to what becomes the default in InertiaRails 4.0, rather than carrying a
  # deprecation warning on every response. Guarantees `errors` is always present in the page
  # props, so the frontend can read `errors.field` without null-checking the container first.
  config.always_include_errors_hash = true

  # Busts the client-side asset cache when the frontend build changes.
  #
  # Inertia compares this version on every visit; a mismatch turns the XHR visit into a full
  # page load, which is what makes a user on the previous release pick up new assets instead
  # of running old JavaScript against a new API.
  #
  # Derived from the frontend's own build rather than from anything in this repository: in
  # development there is no build, so the dev-server URL is a stable placeholder; in
  # production the manifest changes exactly when the assets do.
  config.version = lambda do
    manifest = FrontendAssets::Manifest.instance
    next "development" if manifest.dev_server?

    # Hashing the resolved entry URL is enough: the filename contains a content hash, so it
    # changes if and only if the bundle changes.
    Digest::SHA256.hexdigest(manifest.entry.js)[0, 12]
  rescue FrontendAssets::Manifest::Error
    # Never let asset-version resolution take down a request. Falling back means Inertia
    # cannot detect a stale asset this once, which is strictly better than a 500.
    "unknown"
  end

  # Rails' own deep_transform_keys-based camelization is not applied automatically; props are
  # written in the shape the frontend expects (see DashboardsController#serialize_ui_state).
  # Left off deliberately so the wire format is explicit and greppable rather than implicit.
  config.deep_merge_shared_data = false
end
