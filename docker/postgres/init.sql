-- Runs exactly once, when the data volume is first initialised.
--
-- POSTGRES_DB has already created the primary database by the time this executes.
-- This file adds the companion queue database that Solid Queue's
-- `db/queue_schema.rb` is loaded into.
--
-- Two databases, one PostgreSQL server. Job churn is high-volume, short-lived write
-- traffic; keeping it out of the primary keeps autovacuum, WAL volume and backup size
-- predictable, and lets the queue be truncated or restored independently. It is still
-- one server, one set of credentials and zero Redis.
--
-- NOTE: this name is coupled to POSTGRES_DB in .env. config/database.yml derives the
-- same value as "#{POSTGRES_DB}_queue". If you change POSTGRES_DB, change it here too.
--
-- `bin/rails db:prepare` would also create this database, since the compose role is a
-- superuser. Creating it here as well means the schema load works even in deployments
-- where the application role has no CREATEDB privilege.
CREATE DATABASE sourcebox_queue;

-- Track query statistics from the start. Useful the first time PostgreSQL becomes the
-- bottleneck, which in this architecture is the thing that saturates first.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
