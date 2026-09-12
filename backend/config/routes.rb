Rails.application.routes.draw do
  # --- Authentication ---------------------------------------------------
  #
  # `sessions` is overridden so /users/sign_in renders the Inertia login page rather than
  # Devise's scaffolded ERB view, which references the registration routes that
  # `skip: [:registrations]` removes.
  #
  # The omniauth routes generated here are:
  #   GET|POST /users/auth/google_oauth2           (request phase — POST only, see
  #                                                 config/initializers/omniauth.rb)
  #   GET      /users/auth/google_oauth2/callback  (callback phase)
  #
  # The provider segment is the OmniAuth strategy name, `google_oauth2` — not `google`.
  devise_for :users,
             controllers: {
               sessions: "users/sessions",
               omniauth_callbacks: "users/omniauth_callbacks",
             },
             skip: [ :registrations ]

  # Friendlier alias for the same page, so links and redirects can say /login.
  devise_scope :user do
    get "/login", to: "users/sessions#new", as: :login
  end

  # --- Inertia pages ----------------------------------------------------
  # Server-driven navigation. These render components, not JSON.
  resource :dashboard, only: [ :show ], controller: "dashboards"

  # --- GraphQL ----------------------------------------------------------
  # One endpoint for all client-state reads and writes. No REST duplication.
  post "/graphql", to: "graphql#execute"

  # --- Infrastructure ---------------------------------------------------
  # /health -> the process is alive (touches no dependencies)
  # /ready  -> dependencies are reachable (503 when they are not)
  get "/health", to: "health#show"
  get "/ready",  to: "health#ready"

  root to: redirect("/dashboard")
end
