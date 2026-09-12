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
  #   1. React Refresh preamble — must run before any component module is evaluated, or
  #      hot reloading silently does not work.
  #   2. Vite client — opens the HMR connection.
  #   3. Stylesheets — before the module, so the browser can fetch CSS in parallel and
  #      render without a flash of unstyled content.
  #   4. The entry module itself.
  def frontend_assets_tags(entry = FrontendAssets::Manifest::DEFAULT_ENTRY)
    manifest = FrontendAssets::Manifest.instance
    resolved = manifest.entry(entry)

    tags = []
    tags << react_refresh_tag(manifest) if manifest.dev_server?
    tags << vite_client_tag(manifest) if manifest.dev_server?
    tags.concat(resolved.css.map { |href| stylesheet_tag(href) })
    tags.concat(resolved.preload.map { |href| modulepreload_tag(href) })
    tags << module_script_tag(resolved.js)

    safe_join(tags.compact, "\n")
  end

  private

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

  def vite_client_tag(manifest)
    tag.script(nil, type: "module", src: "#{manifest.dev_server_url.chomp('/')}/@vite/client")
  end

  # The preamble @vitejs/plugin-react normally injects into an HTML entry. Because Rails
  # renders the HTML, it has to be emitted here instead.
  #
  # Carries the CSP nonce, so React Refresh works in development without relaxing the
  # policy to :unsafe_inline.
  def react_refresh_tag(manifest)
    preamble = <<~JS
      import RefreshRuntime from "#{manifest.dev_server_url.chomp('/')}/@react-refresh"
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => (type) => type
      window.__vite_plugin_react_preamble_installed__ = true
    JS

    javascript_tag(preamble, type: "module", nonce: true)
  end
end
