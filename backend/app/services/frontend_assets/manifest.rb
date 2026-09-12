# frozen_string_literal: true

require "net/http"

module FrontendAssets
  # Reads the Vite build manifest produced by the frontend project.
  #
  # This replaces the vite_ruby gem. That gem shells out to `vite build`, owns
  # config/vite.json, and expects the frontend source to live inside the Rails tree --
  # all of which makes the frontend un-splittable from the backend. Here the contract is
  # inverted: the frontend builds itself and publishes a manifest, and Rails only reads
  # it. The two can then live in separate repositories and deploy independently.
  #
  # Three resolution modes, chosen by environment:
  #
  #   VITE_DEV_SERVER_URL set  ->  development. No manifest exists; URLs point straight
  #                                at the Vite dev server, which compiles on demand.
  #   VITE_MANIFEST_PATH set   ->  read from a local file. For deployments that ship the
  #                                manifest as a build artefact or mounted volume.
  #   otherwise                ->  fetch <ASSET_HOST>/manifest.json over HTTP and cache
  #                                it. Needs no shared filesystem between containers.
  class Manifest
    class Error < StandardError; end

    # Vite writes the manifest keyed by the entry's path relative to the frontend root.
    DEFAULT_ENTRY = "src/entrypoints/application.tsx"

    MANIFEST_FILENAME = "manifest.json"

    OPEN_TIMEOUT = 2
    READ_TIMEOUT = 3
    FETCH_ATTEMPTS = 3

    # One entry resolved to browser-ready URLs.
    Entry = Struct.new(:js, :css, :preload, keyword_init: true)

    class << self
      def instance
        @instance ||= new
      end

      # Called from a reloader hook in development so a rebuild is picked up without a
      # server restart.
      def reset!
        @instance = nil
      end
    end

    def initialize
      @mutex = Mutex.new
    end

    def dev_server?
      dev_server_url.present?
    end

    def dev_server_url
      ENV["VITE_DEV_SERVER_URL"].presence
    end

    def asset_host
      ENV["ASSET_HOST"].presence
    end

    # Resolves an entry to the URLs needed to load it.
    #
    # In dev-server mode there is no manifest and no separate CSS file: Vite serves the
    # entry as an ES module and injects styles at runtime, so only the module URL matters.
    def entry(name = DEFAULT_ENTRY)
      if dev_server?
        return Entry.new(js: url_for(name), css: [], preload: [])
      end

      data = manifest.fetch(name) do
        raise Error, <<~MSG
          Entry "#{name}" is not in the Vite manifest.

          Known entries: #{manifest.keys.take(20).join(', ')}

          The frontend build and the backend disagree about the entry name. Check
          `build.rollupOptions.input` in frontend/vite.config.ts.
        MSG
      end

      Entry.new(
        js: url_for(data["file"]),
        css: Array(data["css"]).map { |path| url_for(path) },
        # Modules this entry statically imports. Preloading them stops the browser from
        # discovering the dependency graph one network round trip at a time.
        preload: preload_urls(data)
      )
    end

    private

    # Joins a manifest-relative path onto whichever origin is serving assets. Manifest
    # paths are always relative (vite `base: '/'`), which is what lets one build artefact
    # be served from any host or CDN without rebuilding.
    def url_for(path)
      base = dev_server? ? dev_server_url : asset_host

      return "/#{path.delete_prefix('/')}" if base.blank?

      "#{base.chomp('/')}/#{path.delete_prefix('/')}"
    end

    def preload_urls(data)
      Array(data["imports"]).filter_map do |key|
        imported = manifest[key]
        url_for(imported["file"]) if imported&.key?("file")
      end
    end

    def manifest
      # Double-checked under a mutex: Puma serves requests on multiple threads, and
      # without this several of them would fetch the manifest concurrently on a cold boot.
      return @manifest if @manifest

      @mutex.synchronize do
        @manifest ||= load_manifest
      end
    end

    def load_manifest
      raw = ENV["VITE_MANIFEST_PATH"].present? ? read_from_disk : fetch_over_http

      parsed = JSON.parse(raw)
      raise Error, "Vite manifest is not a JSON object" unless parsed.is_a?(Hash)
      raise Error, "Vite manifest is empty" if parsed.empty?

      parsed
    rescue JSON::ParserError => e
      raise Error, "Vite manifest is not valid JSON: #{e.message}"
    end

    def read_from_disk
      path = Pathname.new(ENV.fetch("VITE_MANIFEST_PATH"))

      unless path.exist?
        raise Error, <<~MSG
          Vite manifest not found at #{path}.

          Build the frontend first:  cd frontend && npm run build
        MSG
      end

      path.read
    end

    # Fetched rather than read from a shared volume, so the backend and frontend
    # containers need nothing in common but a URL.
    def fetch_over_http
      if asset_host.blank?
        raise Error, <<~MSG
          Cannot locate the Vite manifest: neither ASSET_HOST nor VITE_MANIFEST_PATH is set.

          Set ASSET_HOST to the frontend container's URL (it serves #{MANIFEST_FILENAME}),
          or VITE_MANIFEST_PATH to a local manifest file. In development set
          VITE_DEV_SERVER_URL instead and no manifest is needed.
        MSG
      end

      uri = URI.join("#{asset_host.chomp('/')}/", MANIFEST_FILENAME)
      last_error = nil

      FETCH_ATTEMPTS.times do |attempt|
        begin
          response = Net::HTTP.start(
            uri.host, uri.port,
            use_ssl: uri.scheme == "https",
            open_timeout: OPEN_TIMEOUT,
            read_timeout: READ_TIMEOUT
          ) { |http| http.get(uri.request_uri) }

          return response.body if response.is_a?(Net::HTTPSuccess)

          last_error = "HTTP #{response.code}"
        rescue StandardError => e
          last_error = "#{e.class}: #{e.message}"
        end

        # The frontend container may still be starting. Back off briefly rather than
        # failing the first request after a deploy.
        sleep(0.25 * (attempt + 1)) unless attempt == FETCH_ATTEMPTS - 1
      end

      raise Error, <<~MSG
        Could not fetch the Vite manifest from #{uri} after #{FETCH_ATTEMPTS} attempts (#{last_error}).

        Is the frontend container running and reachable at ASSET_HOST?
      MSG
    end
  end
end
