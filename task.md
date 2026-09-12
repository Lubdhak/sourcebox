Act as a Principal Full-Stack Engineer and Core Rails Developer.

Generate a complete, production-ready boilerplate initialization script, project structure, configuration files, database migrations, backend implementation, GraphQL API, frontend implementation, Docker setup, logging/observability architecture, and development/production instructions for a heavy client-state SaaS application.

Use the following exact technology stack:

## TECHNOLOGY STACK

* Backend: Ruby on Rails 8.1
* Database: PostgreSQL 18
* Database features: PostgreSQL JSONB, appropriate JSONB indexing, constraints, and optimized queries
* API Layer: GraphQL Ruby — latest stable version compatible with Rails 8.1
* Frontend Bridge: Inertia.js v3 — Protocol v3+ with Core and React adapters
* Frontend Framework: React 19 + TypeScript
* Build Tool / Asset Pipeline: Vite Ruby
* Authentication: Devise + OmniAuth Google OAuth2
* Background Jobs: Solid Queue
* Queue Architecture: Zero Redis, PostgreSQL-backed
* Async Events: Rails 8.1 Structured Event Reporting using `Rails.event`
* Styling: Tailwind CSS
* Containerization: Docker + Docker Compose
* Logging: Structured JSON logging
* Observability: Rails events, request correlation, GraphQL instrumentation, job instrumentation, frontend navigation timing
* Package Management: Bundler + npm

The final architecture must be suitable as the foundation for a serious SaaS product rather than a toy/demo application.

---

# 1. CORE ARCHITECTURE

Use the following architectural separation:

```text
                         Browser
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
        Inertia v3                     GraphQL
        Navigation                    /graphql
             │                             │
             └──────────────┬──────────────┘
                            ▼
                       Rails 8.1
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
          Devise       GraphQL Ruby    Rails.event
          OAuth             │             │
                            │             ▼
                            │        Solid Queue
                            │             │
                            └──────┬──────┘
                                   ▼
                            PostgreSQL 18
```

Use:

### Inertia for

* Server-driven page rendering.
* Initial page data.
* Page transitions.
* Authentication redirects.
* Application navigation.
* Layouts.
* SPA-like navigation.

### GraphQL for

* Heavy client-state operations.
* Rich data fetching.
* Dashboard state.
* Mutations.
* Filtering.
* Pagination.
* Optimistic updates.
* Client-driven state changes.
* Future real-time/client-heavy functionality.

### Rails Controllers for

* Inertia responses.
* OAuth callbacks.
* Authentication.
* Health/readiness endpoints.
* Infrastructure endpoints.
* Webhooks where required.

Do not create unnecessary REST JSON endpoints.

Do not duplicate business logic between GraphQL and REST.

---

# 2. INERTIA V3 — NO AXIOS

Inertia.js v3 has dropped Axios.

Do not install Axios anywhere in the application.

All Inertia HTTP behavior must use:

* Inertia's native HTTP/XHR implementation.
* Inertia v3 `useHttp`.
* Inertia router APIs.

Use:

```text
useHttp
router
router.on(...)
```

where appropriate.

Do not introduce Axios indirectly.

Clearly explain when `useHttp` should be used versus the application's GraphQL client.

---

# 3. GRAPHQL ARCHITECTURE

Use GraphQL Ruby directly inside Rails.

Do not create:

* Node.js GraphQL server.
* Apollo Server.
* Separate API service.
* REST duplication.

Use a single:

```text
POST /graphql
```

endpoint.

Use GraphQL Ruby's modern class-based API.

Use:

```text
GraphQL::Schema
GraphQL::Dataloader
GraphQL::Schema::Resolver
GraphQL::Schema::Mutation
```

where appropriate.

The GraphQL layer must include:

* Query types.
* Mutation types.
* Input types.
* Enum types.
* Authentication.
* Authorization.
* Dataloader.
* Pagination.
* Error handling.
* Complexity limits.
* Depth limits.
* Query safeguards.
* Structured logging.
* Request instrumentation.

---

# 4. GRAPHQL AUTHENTICATION

Use the existing Devise session for GraphQL authentication.

Do not create a second authentication mechanism.

The GraphQL controller must expose:

```ruby
context[:current_user]
```

or an equivalent strongly structured context.

GraphQL queries and mutations must explicitly verify authentication where required.

Unauthorized requests should return appropriate GraphQL errors.

Never expose internal Rails exceptions, stack traces, SQL, secrets, or sensitive information to GraphQL clients.

---

# 5. GRAPHQL AUTHORIZATION

Implement authorization at the GraphQL boundary.

Ensure users can only access:

* Their own dashboards.
* Their own client state.
* Resources they are authorized to access.

Do not rely solely on the frontend for authorization.

The backend must enforce all access controls.

Keep authorization logic reusable rather than duplicating it across every resolver.

---

# 6. GRAPHQL SECURITY

Configure production-safe GraphQL behavior.

Include:

* Query depth limits.
* Query complexity limits.
* Pagination limits.
* Maximum page sizes.
* Protection against unbounded queries.
* Authentication checks.
* Authorization checks.
* Structured error handling.
* Introspection policy.
* Production-safe error responses.

Explain the tradeoffs of disabling GraphQL introspection in production.

---

# 7. GRAPHQL DATALOADER

Use GraphQL Ruby's modern:

```ruby
GraphQL::Dataloader
```

to prevent N+1 queries.

Provide a complete working example.

For example:

```text
Dashboard
   │
   ├── User
   ├── Account
   └── Related records
```

should not cause one SQL query per GraphQL object.

Provide:

```text
app/graphql/loaders/
```

with a reusable record loader.

Demonstrate how GraphQL types use the loader.

---

# 8. GRAPHQL SCHEMA

Create a schema supporting approximately:

```graphql
type Query {
  currentUser: User
  dashboard(id: ID!): Dashboard
}

type Mutation {
  updateDashboardState(
    input: UpdateDashboardStateInput!
  ): Dashboard!
}
```

Use strongly typed GraphQL objects.

Create:

```text
User
Dashboard
PageInfo
```

and appropriate input types.

For dashboard UI state, explain the tradeoff between:

```text
GraphQL::Types::JSON
```

and strongly typed GraphQL input objects.

Prefer strongly typed GraphQL fields for stable application state.

Use JSON only where genuinely dynamic client state requires it.

---

# 9. GRAPHQL CLIENT

Create:

```text
app/frontend/lib/graphql.ts
```

Implement a lightweight typed GraphQL client using:

```text
fetch
```

Do not use Axios.

The client must:

* POST to `/graphql`.
* Send CSRF information correctly.
* Handle GraphQL errors.
* Handle HTTP errors.
* Support typed responses.
* Support variables.
* Support operation names.
* Be easy to replace with another GraphQL client later.

Demonstrate:

* GraphQL query.
* GraphQL mutation.

---

# 10. RAILS EVENT ARCHITECTURE

Use Rails 8.1 structured events:

```ruby
Rails.event.notify(...)
Rails.event.subscribe(...)
```

Establish an event-driven architecture.

Use events such as:

```text
user.authenticated
user.created
dashboard.updated
graphql.request
graphql.mutation
graphql.error
oauth.success
oauth.failure
job.enqueued
job.completed
job.failed
```

Events must contain structured metadata rather than arbitrary log strings.

Example:

```ruby
Rails.event.notify(
  "dashboard.updated",
  user_id: current_user.id,
  dashboard_id: dashboard.id
)
```

Do not perform expensive work synchronously inside controllers or GraphQL mutations.

---

# 11. ASYNC EVENT PROCESSING

Use this architecture:

```text
GraphQL Mutation
      │
      ▼
Update PostgreSQL
      │
      ▼
Rails.event.notify
      │
      ▼
Rails.event.subscribe
      │
      ▼
Solid Queue
      │
      ├── Audit Job
      ├── Analytics Job
      └── Notification Job
```

Provide:

```text
app/services/events/
app/jobs/
config/initializers/event_subscribers.rb
```

The request thread must not wait for heavy secondary processing.

---

# 12. SOLID QUEUE — ZERO REDIS

Use:

```ruby
config.active_job.queue_adapter = :solid_queue
```

Solid Queue must use PostgreSQL.

Do not use:

* Redis.
* Sidekiq.
* Resque.
* RabbitMQ.
* Kafka.

Do not add the `redis` gem.

Provide:

```text
config/queue.yml
```

with production-ready configuration.

Explain:

1. Single PostgreSQL database.
2. Separate Solid Queue PostgreSQL database.

Use the simplest safe architecture by default.

Include:

```bash
rails solid_queue:install:migrations
rails db:create
rails db:migrate
```

---

# 13. DEVISE + GOOGLE OAUTH

Implement:

```text
app/models/user.rb
app/controllers/users/omniauth_callbacks_controller.rb
config/initializers/omniauth.rb
```

Support:

* Google OAuth2.
* Existing user lookup.
* New user creation.
* Provider.
* UID.
* Avatar URL.
* Name.
* Email.
* Secure OAuth failure handling.
* Authentication event reporting.

When authentication succeeds:

```text
Google
  ↓
OmniAuth
  ↓
Devise
  ↓
User
  ↓
Rails.event.notify
  ↓
Solid Queue
```

---

# 14. INERTIA + GOOGLE OAUTH REDIRECT

Because Inertia uses XHR for navigation, the Google OAuth flow must break out of the Inertia request context.

The login button must safely initiate:

```javascript
window.location = "/users/auth/google"
```

or the appropriate equivalent.

Do not attempt to perform the external OAuth redirect as a normal Inertia XHR request.

---

# 15. DATABASE

Use PostgreSQL 18.

Create migrations that update `users` with:

```text
uid
provider
avatar_url
```

and create:

```text
dashboards
```

with:

```text
id
user_id
ui_state JSONB
created_at
updated_at
```

Use appropriate:

* Foreign keys.
* Unique constraints.
* NOT NULL constraints.
* Indexes.

Avoid unnecessary indexes.

Explain when a JSONB GIN index is useful and when it is unnecessary.

---

# 16. INERTIA FRONTEND

Create:

```text
app/frontend/
├── entrypoints/
│   └── application.tsx
├── Pages/
│   ├── Auth/
│   │   └── Login.tsx
│   └── Dashboard/
│       └── Show.tsx
├── components/
└── lib/
    ├── graphql.ts
    └── logger.ts
```

Use:

* React 19.
* TypeScript strict mode.
* Inertia v3.
* React `createRoot`.
* Tailwind CSS.

---

# 17. INERTIA ENTRYPOINT

Provide:

```text
app/frontend/entrypoints/application.tsx
```

Implement:

* React 19 `createRoot`.
* Inertia v3.
* Page resolution.
* TypeScript.
* Strict mode where appropriate.

Add global navigation listeners:

```javascript
router.on("start", ...)
router.on("finish", ...)
```

or the appropriate current Inertia v3 APIs.

Capture:

```text
navigation start
navigation finish
duration
URL
status
```

---

# 18. VITE RUBY

Configure Vite Ruby to completely own:

```text
app/frontend/
```

Do not allow Propshaft/Importmaps to conflict with Vite.

Provide:

```text
vite.config.ts
package.json
```

Configure:

* React 19.
* TypeScript.
* Vite Ruby.
* React refresh.
* TypeScript path aliases.

---

# 19. RAILS APPLICATION LAYOUT

Provide:

```text
app/views/layouts/application.html.erb
```

using the appropriate Vite Ruby helpers:

```erb
<%= vite_react_refresh_tag %>
<%= vite_javascript_tag "application" %>
```

Ensure correct ordering.

Explain development and production behavior.

---

# 20. TAILWIND CSS

Configure the current recommended Tailwind CSS setup compatible with:

* Rails 8.1.
* Vite Ruby.
* React 19.
* TypeScript.

Provide:

* npm installation.
* Configuration.
* CSS entrypoint.
* Vite integration.

---

# 21. LOGIN PAGE

Create:

```text
app/frontend/Pages/Auth/Login.tsx
```

Requirements:

* React 19.
* TypeScript.
* Tailwind CSS.
* Google login button.
* Accessible UI.
* Loading state.
* Safe OAuth redirect.
* No Axios.

---

# 22. DASHBOARD PAGE

Create:

```text
app/frontend/Pages/Dashboard/Show.tsx
```

It must:

* Display Google profile image.
* Display user's name.
* Display email.
* Load dashboard state.
* Execute a GraphQL query.
* Execute a GraphQL mutation.
* Implement optimistic UI updates.
* Persist state into PostgreSQL JSONB.
* Roll back when mutation fails.
* Demonstrate Inertia v3 `useHttp`.
* Demonstrate Inertia navigation timing.

Clearly explain the difference between:

```text
Inertia useHttp
```

and:

```text
GraphQL fetch
```

---

# 23. TYPESCRIPT TYPES

Use strict TypeScript.

Create types for:

```text
User
Dashboard
DashboardUIState
GraphQL responses
GraphQL mutations
GraphQL errors
```

Avoid:

```typescript
any
```

unless crossing a genuinely dynamic JSONB boundary.

---

# 24. DOCKERIZATION

Fully dockerize the application.

Provide:

```text
Dockerfile
docker-compose.yml
.dockerignore
docker/
├── entrypoint.sh
└── postgres/
    └── init.sql
```

Use a multi-stage Docker build:

```text
Base
  ↓
Dependencies
  ↓
Build
  ↓
Production
```

The production image must:

* Be minimal.
* Run Rails in production.
* Precompile Vite assets.
* Exclude unnecessary build dependencies.
* Run as a non-root user.
* Never contain secrets.
* Use environment variables.
* Support Docker layer caching.
* Use appropriate health checks.

---

# 25. DOCKER COMPOSE

Provide a local environment with:

```text
web
postgres
worker
```

Architecture:

```text
Browser
   │
   ▼
 web
   │
   ├───────────────┐
   ▼               ▼
PostgreSQL 18    worker
                   │
                   ▼
              Solid Queue
```

The `web` and `worker` containers should use the same application image but execute different processes.

Provide commands:

```bash
docker compose up web
docker compose up worker
```

---

# 26. DOCKER HEALTH CHECKS

Implement:

```text
GET /health
GET /ready
```

Use:

```text
/health → process is alive
/ready  → required application dependencies are available
```

Add Docker health checks for:

* PostgreSQL.
* Rails.
* Worker where practical.

Keep health checks lightweight.

---

# 27. ENVIRONMENT CONFIGURATION

Provide:

```text
.env.example
```

with:

```text
RAILS_ENV
DATABASE_URL
POSTGRES_HOST
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
SECRET_KEY_BASE

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

VITE_RUBY_HOST
VITE_RUBY_PORT
```

Ensure:

```text
.env
```

is ignored by Git.

Never bake credentials into Docker images.

Explain how production secrets should be injected through:

* Deployment platform secrets.
* Docker secrets.
* Kubernetes secrets.
* Cloud secret managers.

---

# 28. STRUCTURED LOGGING

Implement production-grade structured JSON logging.

Logs must be machine-readable.

Example:

```json
{
  "event": "user.authenticated",
  "request_id": "abc123",
  "user_id": "42",
  "provider": "google",
  "timestamp": "..."
}
```

Do not rely on plain strings like:

```text
User logged in successfully
```

Logs should work with:

* Datadog.
* Grafana/Loki.
* ELK/OpenSearch.
* CloudWatch.
* GCP Cloud Logging.
* Kubernetes logging.

---

# 29. SECURITY-SAFE LOGGING

Never log:

* Passwords.
* OAuth access tokens.
* OAuth refresh tokens.
* Session cookies.
* CSRF tokens.
* Authorization headers.
* API keys.
* Secrets.

Do not dump complete GraphQL variables.

Redact sensitive fields.

Avoid unnecessarily logging personal information.

---

# 30. RAILS EVENT LOGGING

Create consistent event names:

```text
user.authenticated
user.created
dashboard.updated
graphql.request
graphql.mutation
graphql.error
oauth.success
oauth.failure
job.enqueued
job.completed
job.failed
```

Include structured metadata:

```text
event
timestamp
request_id
user_id
account_id
operation
duration_ms
status
error_class
error_message
```

Use `Rails.event` as the primary event mechanism.

Avoid creating a custom logging framework when Rails' existing functionality is sufficient.

---

# 31. GRAPHQL OBSERVABILITY

For every GraphQL request, capture:

```text
request_id
user_id
operation_name
operation_type
duration_ms
status
error_count
```

Example:

```json
{
  "event": "graphql.request",
  "operation_name": "Dashboard",
  "operation_type": "query",
  "duration_ms": 18,
  "status": "success"
}
```

For mutations:

```json
{
  "event": "graphql.mutation",
  "operation_name": "UpdateDashboardState",
  "user_id": "42",
  "duration_ms": 24,
  "status": "success"
}
```

For errors:

```json
{
  "event": "graphql.error",
  "operation_name": "UpdateDashboardState",
  "request_id": "abc123",
  "error_class": "..."
}
```

Never expose internal details to the GraphQL client.

---

# 32. REQUEST CORRELATION

Implement request correlation across the entire application.

Use:

```text
request_id
```

across:

* Rails.
* GraphQL.
* Inertia.
* Rails events.
* Solid Queue.
* Background jobs.
* Authentication.
* Error logs.

When a GraphQL mutation triggers a job:

```text
HTTP Request
 request_id=abc123
      │
      ▼
GraphQL Mutation
      │
      ▼
Rails.event
      │
      ▼
Solid Queue
      │
      ▼
Background Job
```

Preserve the original correlation ID where appropriate.

Also retain a unique job ID.

---

# 33. SOLID QUEUE JOB LOGGING

Capture:

```text
job_id
job_class
queue_name
request_id
user_id
started_at
completed_at
duration_ms
status
retry_count
error_class
```

Example:

```json
{
  "event": "job.completed",
  "job_class": "AuditDashboardChangeJob",
  "job_id": "...",
  "queue": "default",
  "duration_ms": 87,
  "status": "success"
}
```

Do not log entire job arguments if they may contain sensitive or large data.

---

# 34. FRONTEND LOGGING

Create:

```text
app/frontend/lib/logger.ts
```

Implement:

```text
logger.debug()
logger.info()
logger.warn()
logger.error()
```

Support structured metadata.

Example:

```typescript
logger.info("dashboard.updated", {
  dashboardId,
  optimistic: true
})
```

Disable debug logging in production.

Do not expose secrets through browser logs.

---

# 35. INERTIA PERFORMANCE LOGGING

Use:

```text
router.on("start")
router.on("finish")
```

to measure navigation performance.

Capture:

```text
event
URL
duration_ms
status
```

Example:

```json
{
  "event": "inertia.navigation",
  "url": "/dashboard",
  "duration_ms": 124,
  "status": "success"
}
```

Do not log complete page props.

---

# 36. ERROR HANDLING

Implement centralized error handling for:

* Rails exceptions.
* GraphQL errors.
* GraphQL validation errors.
* OAuth failures.
* Active Job failures.
* Solid Queue failures.
* Frontend errors.

Use structured events.

Do not use scattered:

```ruby
puts
print
```

for production diagnostics.

---

# 37. DOCKER LOGGING

Containers must log to:

```text
STDOUT
STDERR
```

Do not store application logs in files inside containers.

The following should provide useful structured output:

```bash
docker compose logs web
docker compose logs worker
```

Explain why container-native logging is preferable.

---

# 38. FRONTEND ERROR BOUNDARY

Add a React error boundary.

Capture unexpected frontend errors using the structured frontend logger.

Provide a production-safe fallback UI.

Do not expose internal stack traces to end users.

---

# 39. PROJECT STRUCTURE

Provide the final project structure similar to:

```text
.
├── app/
│   ├── controllers/
│   │   ├── graphql_controller.rb
│   │   ├── health_controller.rb
│   │   └── users/
│   │       └── omniauth_callbacks_controller.rb
│   │
│   ├── graphql/
│   │   ├── application_graphql.rb
│   │   ├── schema.rb
│   │   ├── types/
│   │   │   ├── base_object.rb
│   │   │   ├── base_input_object.rb
│   │   │   ├── base_enum.rb
│   │   │   ├── user_type.rb
│   │   │   ├── dashboard_type.rb
│   │   │   └── page_info_type.rb
│   │   ├── queries/
│   │   ├── mutations/
│   │   │   ├── base_mutation.rb
│   │   │   └── update_dashboard_state.rb
│   │   ├── loaders/
│   │   │   └── record_loader.rb
│   │   └── resolvers/
│   │
│   ├── jobs/
│   │   ├── audit_dashboard_change_job.rb
│   │   ├── analytics_event_job.rb
│   │   └── notification_job.rb
│   │
│   ├── models/
│   │   ├── user.rb
│   │   └── dashboard.rb
│   │
│   ├── services/
│   │   ├── events/
│   │   └── logging/
│   │
│   └── frontend/
│       ├── Pages/
│       │   ├── Auth/
│       │   │   └── Login.tsx
│       │   └── Dashboard/
│       │       └── Show.tsx
│       ├── components/
│       ├── lib/
│       │   ├── graphql.ts
│       │   └── logger.ts
│       └── entrypoints/
│           └── application.tsx
│
├── config/
│   ├── initializers/
│   │   ├── omniauth.rb
│   │   └── event_subscribers.rb
│   ├── application.rb
│   ├── database.yml
│   ├── queue.yml
│   └── routes.rb
│
├── db/
│   └── migrate/
│
├── docker/
│   ├── entrypoint.sh
│   └── postgres/
│       └── init.sql
│
├── app/views/layouts/
│   └── application.html.erb
│
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── .gitignore
├── Gemfile
├── Gemfile.lock
├── package.json
├── package-lock.json
├── vite.config.ts
└── README.md
```

---

# 40. CLI INITIALIZATION

Provide exact commands for initializing the entire application.

Include:

```bash
rails new
bundle add
npm install
```

commands for every dependency.

Ensure appropriate versions for:

```text
Rails 8.1
GraphQL Ruby
Inertia v3
@inertiajs/react
React 19
React DOM 19
TypeScript
Vite Ruby
Devise
omniauth-google-oauth2
Solid Queue
Tailwind CSS
```

Verify the latest stable compatible versions rather than blindly assuming version numbers.

Explain any compatibility constraints.

Do not use outdated APIs.

---

# 41. COMPLETE CONFIGURATION FILES

Provide complete, copy-paste-ready versions of:

```text
Gemfile
package.json
vite.config.ts
config/application.rb
config/database.yml
config/queue.yml
config/routes.rb
config/initializers/omniauth.rb
config/initializers/event_subscribers.rb
app/views/layouts/application.html.erb
Dockerfile
docker-compose.yml
.dockerignore
.env.example
```

Do not provide pseudocode where real configuration is possible.

---

# 42. COMPLETE BACKEND CODE

Provide complete implementations for:

```text
app/models/user.rb
app/models/dashboard.rb
app/controllers/graphql_controller.rb
app/controllers/health_controller.rb
app/controllers/users/omniauth_callbacks_controller.rb
app/graphql/schema.rb
app/graphql/types/*
app/graphql/mutations/*
app/graphql/loaders/*
app/jobs/*
app/services/events/*
app/services/logging/*
```

Ensure all code is internally consistent.

---

# 43. COMPLETE FRONTEND CODE

Provide complete implementations for:

```text
app/frontend/entrypoints/application.tsx
app/frontend/Pages/Auth/Login.tsx
app/frontend/Pages/Dashboard/Show.tsx
app/frontend/lib/graphql.ts
app/frontend/lib/logger.ts
```

Use:

* React 19.
* TypeScript.
* Inertia v3.
* Tailwind.
* GraphQL.
* Optimistic updates.
* Error rollback.
* Navigation performance logging.

---

# 44. DATABASE SETUP

Provide migrations and exact commands:

```bash
rails solid_queue:install:migrations
rails db:create
rails db:migrate
```

Explain migration ordering.

Ensure PostgreSQL 18 is used.

---

# 45. DOCKER DEVELOPMENT COMMANDS

Provide:

```bash
docker compose build
docker compose up
docker compose down
docker compose logs
docker compose exec web bin/rails db:migrate
docker compose exec web bin/rails console
```

and other essential commands.

Explain which commands execute inside the container.

---

# 46. PRODUCTION DEPLOYMENT

Explain a production deployment strategy using the Docker image.

Cover:

```text
Build
  ↓
Container Registry
  ↓
Production Web Container
  ↓
Production Worker Container
  ↓
PostgreSQL 18
```

Explain:

* Database migrations.
* Asset compilation.
* Environment variables.
* Secrets.
* Health checks.
* Worker scaling.
* Web scaling.
* Database backups.
* Logging.
* Rollbacks.

Do not assume Kubernetes unless necessary.

Mention how the architecture can later be deployed to:

* AWS ECS.
* Kubernetes.
* Fly.io.
* Render.
* Railway.
* Google Cloud Run or equivalent platforms.

---

# 47. SCALING STRATEGY

Explain how this architecture scales from:

```text
1 web container
1 worker
1 PostgreSQL
```

to:

```text
N web containers
N Solid Queue workers
PostgreSQL primary
Read replicas where appropriate
Centralized logging
```

Explain which components are stateless.

Explain where PostgreSQL can become the bottleneck.

Explain when to introduce caching without violating the initial Zero-Redis architecture.

---

# 48. SECURITY CHECKLIST

Include a security checklist covering:

* Devise.
* Google OAuth.
* CSRF.
* Session security.
* GraphQL authorization.
* GraphQL query limits.
* Rate limiting considerations.
* JSONB validation.
* SQL injection prevention.
* XSS.
* Secrets.
* Docker non-root execution.
* Secure cookies.
* HTTPS.
* CORS where applicable.
* Log redaction.
* OAuth token protection.
* Production GraphQL introspection policy.

---

# 49. OBSERVABILITY ARCHITECTURE

Provide the final architecture:

```text
                         Browser
                            │
                ┌───────────┴───────────┐
                │                       │
          Inertia logs            GraphQL logs
                │                       │
                └───────────┬───────────┘
                            ▼
                         Rails
                            │
                       Rails.event
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
      Structured Logs                Solid Queue
              │                           │
              ▼                           ▼
       Log Aggregator              Background Jobs
              │                           │
              └─────────────┬─────────────┘
                            ▼
                    Observability Platform
```

Explain how the architecture can later integrate with OpenTelemetry without requiring a major rewrite.

---

# 50. FINAL PRODUCTION CHECKLIST

End with a production-readiness checklist covering:

* Rails 8.1.
* PostgreSQL 18.
* GraphQL Ruby.
* Inertia v3.
* React 19.
* TypeScript strict mode.
* Vite Ruby.
* Devise.
* Google OAuth.
* Solid Queue.
* Zero Redis.
* Tailwind CSS.
* Docker.
* Multi-stage builds.
* Non-root containers.
* Health checks.
* Secrets management.
* Structured JSON logging.
* Rails.event.
* GraphQL observability.
* Background job observability.
* Request correlation IDs.
* Error handling.
* GraphQL depth/complexity limits.
* Authorization.
* Dataloader/N+1 protection.
* JSONB strategy.
* Optimistic UI.
* Rollback handling.
* Production asset compilation.
* STDOUT/STDERR container logging.
* Database backups.
* Worker scaling.
* Web scaling.

---

# 51. IMPORTANT IMPLEMENTATION RULE

Before generating the code, verify the **current official APIs and compatibility** for all major components.

In particular, do not rely on old examples for:

* Rails 8.1.
* GraphQL Ruby.
* Inertia.js v3.
* `@inertiajs/react`.
* React 19.
* Vite Ruby.
* Devise.
* OmniAuth Google OAuth2.
* Solid Queue.
* Tailwind CSS.
* PostgreSQL 18.

If an API has changed, use the current recommended implementation.

Clearly identify any compatibility caveats.

The resulting project must be internally consistent and actually runnable.

Do not provide pseudo-production code.

Prefer simple, explicit implementations over unnecessary abstractions.

Do not use Axios.

Do not use Redis.

Do not create a separate Node.js backend.

Do not duplicate business logic between REST and GraphQL.

Use strong typing, secure defaults, early returns, small focused classes, structured logging, and production-oriented error handling.
