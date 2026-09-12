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
  #   1. Stylesheets — before the module, so the browser can fetch CSS in parallel and
  #      render without a flash of unstyled content.
  #   2. The entry module itself.
  #
  # Two tags that a Vite + React setup normally needs are deliberately absent, because
  # HMR is disabled in vite.config.ts:
  #
  #   * The Vite client (`/@vite/client`). It is what opens the HMR websocket, and it
  #     still contains that connect-and-retry logic even when the server has HMR off — so
  #     including it produces a browser that fails to connect on a loop, against a server
  #     that was never going to answer.
  #   * The React Refresh preamble. @vitejs/plugin-react stops injecting `$RefreshReg$`
  #     calls into modules once HMR is off, so nothing consumes the globals it defines.
  #
  # Both come back if HMR is re-enabled; see the comment in vite.config.ts.
  def frontend_assets_tags(entry = FrontendAssets::Manifest::DEFAULT_ENTRY)
    manifest = FrontendAssets::Manifest.instance
    resolved = manifest.entry(entry)

    tags = []
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

end
