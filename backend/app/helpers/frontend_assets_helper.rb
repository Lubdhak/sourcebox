# frozen_string_literal: true

# View helpers that render the frontend's assets into the layout.
#
# Replaces vite_ruby's vite_javascript_tag / vite_client_tag / vite_react_refresh_tag.
# Everything here is derived from FrontendAssets::Manifest, so the layout does not care
# whether the frontend is a dev server on another port or an nginx container behind a CDN.
module FrontendAssetsHelper
  # Renders every tag needed to boot the frontend, in the required order.
  #
  # Order is not cosmetic:
  #   1. When FRONTEND_HOT_RELOAD is on: React Refresh preamble, then the Vite client.
  #      The preamble must run first or @vitejs/plugin-react cannot register.
  #   2. Stylesheets — before the module, so the browser can fetch CSS in parallel and
  #      render without a flash of unstyled content.
  #   3. The entry module itself.
  #
  # The Vite client and React Refresh preamble are omitted unless FRONTEND_HOT_RELOAD is
  # on. The client opens an HMR websocket and retries forever if the server has HMR off,
  # which is the default.
  def frontend_assets_tags(entry = FrontendAssets::Manifest::DEFAULT_ENTRY)
    manifest = FrontendAssets::Manifest.instance
    resolved = manifest.entry(entry)

    tags = []
    if frontend_hot_reload? && manifest.dev_server?
      tags << react_refresh_tag(manifest)
      tags << vite_client_tag(manifest)
    end
    tags.concat(resolved.css.map { |href| stylesheet_tag(href) })
    tags.concat(resolved.preload.map { |href| modulepreload_tag(href) })
    tags << module_script_tag(resolved.js)

    safe_join(tags.compact, "\n")
  end

  private

  def frontend_hot_reload?
    ActiveModel::Type::Boolean.new.cast(ENV.fetch("FRONTEND_HOT_RELOAD", false))
  end

  def vite_client_tag(manifest)
    tag.script(
      nil,
      type: "module",
      src: "#{manifest.dev_server_url.chomp('/')}/@vite/client",
      crossorigin: "anonymous"
    )
  end

  # Matches @vitejs/plugin-react's preamble, with an absolute URL because the HTML is
  # served from Rails and the runtime from Vite. `nonce: true` uses the CSP nonce so this
  # inline module is allowed without script-src 'unsafe-inline'.
  def react_refresh_tag(manifest)
    runtime = "#{manifest.dev_server_url.chomp('/')}/@react-refresh"
    # Keep this in lockstep with @vitejs/plugin-react's preambleCode. The __vite_plugin_react
    # flag is required: without it the plugin throws and the page stays blank.
    preamble = <<~JS
      import RefreshRuntime from #{runtime.to_json};
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    JS

    tag.script(preamble.html_safe, type: "module", nonce: content_security_policy_nonce)
  end

  # Cross-origin by definition: the document comes from Rails and the asset from the
  # frontend origin. Module scripts are always fetched in CORS mode, so the attribute is
  # required rather than optional -- without it the browser refuses the response even when
  # the server sends Access-Control-Allow-Origin.
  def module_script_tag(src)
    tag.script(nil, type: "module", src: src, crossorigin: "anonymous")
  end

  def stylesheet_tag(href)
    tag.link(rel: "stylesheet", href: href, crossorigin: "anonymous")
  end

  def modulepreload_tag(href)
    tag.link(rel: "modulepreload", href: href, crossorigin: "anonymous")
  end
end
