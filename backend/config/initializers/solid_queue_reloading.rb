# frozen_string_literal: true

# Code reloading for the worker process, in development only.
#
# Solid Queue wraps every poll and every job execution in `SolidQueue.app_executor`, which
# its engine defaults to `Rails.application.executor`. The executor manages per-unit-of-work
# state (connection checkout, CurrentAttributes reset) but never checks whether files on disk
# have changed. The consequence is that `bin/jobs` boots once and then runs the job code it
# loaded at boot forever: editing a job class has no effect until the worker is restarted,
# which is a genuinely confusing way to lose ten minutes.
#
# `Rails.application.reloader` is an executor that additionally runs the file-change check
# and reloads constants before yielding. Swapping it in gives the worker the same
# edit-and-it-works behaviour the web process already has.
#
# Safety: the reloader serialises reloading against running code with
# ActiveSupport::Dependencies.interlock, which is the same mechanism that makes reloading
# safe across concurrent Puma threads. Multiple worker threads are no different.
#
# Development only, deliberately. In production this would add a filesystem check to every
# poll for no benefit -- the code cannot change under a running container.
#
# Set from an initializer rather than from config/environments/development.rb because
# `Rails.application.reloader` does not exist yet while that file is evaluated. Solid Queue
# reads this config in an initializer hooked `before: :run_prepare_callbacks`, which runs
# after config/initializers, and assigns with `||=` -- so this value wins.
if Rails.env.development?
  Rails.application.config.solid_queue.app_executor = Rails.application.reloader
end
