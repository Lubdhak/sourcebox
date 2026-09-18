# Sourcebox

## Live & managed services

- **Database (Neon - Managed)**  
  `<add Neon project URL>`

- **Frontend (Vercel)**  
  `<add Vercel project URL>`

- **Backend (Render)**  
  `<add Render web service URL>`

The deployment topology is:

1. Neon provides the `sourcebox` PostgreSQL database and the derived
   `sourcebox_queue` and `sourcebox_cable` databases.
2. Vercel deploys `frontend/` and serves the Vite `manifest.json` and hashed assets.
3. Render deploys the Rails web service and the separate Solid Queue worker from
   `render.yaml`.

Copy the provider-specific templates in `env_vars/` when configuring the services.
These files contain placeholders only; real credentials belong in Neon, Vercel, and
Render secret stores, not in the repository.

### Provider configuration

#### Neon

Create a PostgreSQL project and database named `sourcebox`. Use the direct endpoint
(the hostname without `-pooler`) in `POSTGRES_HOST`; the Render pre-deploy migration
must be able to create the companion databases. Use the Neon role and password as
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_SSLMODE=require`.
The Render pre-deploy command runs `bin/rails db:prepare`, which creates and migrates
the primary, queue, and cable databases.

#### Vercel

Create a project with root directory `sourcebox/frontend`. The committed
`frontend/vercel.json` runs the typecheck/build and exposes the manifest and assets
with the CORS and cache headers required by Rails. Copy the resulting Vercel URL to
Render's `ASSET_HOST`.

#### Render

Connect the repository using the Blueprint in `render.yaml`. Set `APP_URL` to the
Render web-service URL and `ASSET_HOST` to the Vercel URL. Set the Neon and Google
OAuth values in both the web and worker services. Register
`<APP_URL>/users/auth/google_oauth2/callback` as an authorized Google OAuth redirect
URI.

This README would normally document whatever steps are necessary to get the
application up and running.

Things you may want to cover:

* Ruby version

* System dependencies

* Configuration

* Database creation

* Database initialization

* How to run the test suite

* Services (job queues, cache servers, search engines, etc.)

* Deployment instructions

* ...

Upcoming Features - 

- add capacity for owner & admin to give user access to view only specific node all its downstream nodes only.

- LLM based data insertion

- Improve for both user & agent

- Remove Depth & Associated Overview + concept, system node Types. a node can be just anythin but also make sure when connecting two node prompt and mandate user to name the relation. delete it from db level.

- add provison for filling data / search programicatlly

- add vector search & RAG support + HumanView | Stats being Tracked | VectorView | Agent Reads | 

- add / validate node operations 

- Draft & Publish state of node -> IF goes from published to draft again people with permissions[except]

- Image Support both upload + paste + drag & drop.

- Dependant parts of graph is being edited 

- Rbac

- calender view to insert date [default today on first load, next time onwards last selected date] : https://ui.shadcn.com/docs/components/aria/calendar

- Node added & updated by + what was updated

- Node linking with arrow direction + mandate naming the relation