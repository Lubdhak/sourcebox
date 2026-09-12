Rails.application.routes.draw do
  # --- Authentication ---------------------------------------------------
  # Generates the OAuth request phase at /users/auth/google_oauth2 and the callback at
  # /users/auth/google_oauth2/callback. The provider segment is the OmniAuth strategy
  # name, which is `google_oauth2` -- not `google`.
  devise_for :users,
             controllers: { omniauth_callbacks: "users/omniauth_callbacks" },
             skip: [ :registrations ]

  devise_scope :user do
    get "/login", to: "sessions#new", as: :login
  end

  # --- Inertia pages ----------------------------------------------------
  # Server-driven navigation. These render components, not JSON.
  resource :dashboard, only: [ :show ], controller: "dashboards"

  # --- GraphQL ----------------------------------------------------------
  # One endpoint for all client-state reads and writes. No REST duplication.
  post "/graphql", to: "graphql#execute"

  # --- Infrastructure ---------------------------------------------------
  # /health -> the process is alive (no dependencies touched)
  # /ready  -> dependencies are reachable (returns 503 when they are not)
  get "/health", to: "health#show"
  get "/ready",  to: "health#ready"

  root to: redirect("/dashboard")
end
