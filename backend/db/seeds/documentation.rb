# frozen_string_literal: true

# A worked example of the documentation domain: the field of system design, documented.
#
# Loaded from db/seeds.rb. Kept in its own file because it is a different kind of fixture
# from the user accounts -- this one exists to make the canvas worth looking at on a fresh
# checkout. A body of knowledge is a better demonstration than an architecture diagram:
# the interesting edges are `requires`, `enables`, `constrains` and `trades_off_with`,
# none of which fit in a tree, and several ideas genuinely belong under two parents at
# once.
#
# It reaches the full seven rungs on purpose. The subject in one card, the pressures a
# system is designed against, the named concepts, the mechanisms under them, the real
# technologies that implement those mechanisms, the internals of a given technology, and
# finally the settings you actually type. Each rung says the same thing as the one above
# it in more words, so a reader who stops at rung two has still read something true.
#
# Converging rather than merely idempotent: nodes are matched by title, blocks by
# position, and edges by their (source, target, type) triple, so editing the data below
# and re-running `./dev seed` updates the existing space instead of duplicating it or
# failing.
#
# Written against the models rather than the operations. The operations emit an event per
# mutation, which is right for a user action and wrong here: re-seeding would enqueue a
# job for every node in the space to record that a fixture was refreshed. The space itself
# does go through Documentation::CreateSpace.

SEED_SPACE_OWNER_EMAIL = "lubi@gmail.com"
SEED_SPACE_SLUG = "system-design-knowledge-graph"

# Most nodes are one card and one paragraph. Only the ones a reader is expected to stop at
# carry several blocks, and those are written out in full below.
one = lambda do |title, _node_type, summary, text, metadata = {}|
  {
    title: title,
    summary: summary,
    metadata: metadata,
    blocks: [ { block_type: "text", data: { "text" => text } } ]
  }
end

# ---------------------------------------------------------------------- rung 0: the field
FIELD_NODES = [
  {
    title: "System Design",
    summary: "Choosing which guarantees to give up, and being able to say why.",
    metadata: { "kind" => "field", "status" => "living" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "title" => "What this is",
          "markdown" => <<~MD
            System design is not a catalogue of components. It is the practice of deciding
            **which properties a system will fail to provide**, deliberately, and of
            arranging the parts so that those failures are the survivable ones.

            Almost everything below is a trade. Caching trades freshness for latency.
            Replication trades write cost for read throughput and survivability. Sharding
            trades cross-shard queries for headroom. A design is good when the trades it
            makes match what the product needs -- not when it uses the most machinery.

            Dive into an area to see its concepts, and keep diving: the mechanisms are
            under the concepts, the real technologies under the mechanisms, and the
            settings you would actually type under those.
          MD
        }
      },
      {
        block_type: "table",
        data: {
          "title" => "The questions every design answers",
          "columns" => [ "Question", "Answered by", "Failing to answer looks like" ],
          "rows" => [
            [ "Where does load go?", "Scaling & Load", "One machine is hot, the rest idle" ],
            [ "Where does truth live?", "Data Storage", "Two services disagree about a row" ],
            [ "How stale may an answer be?", "Caching", "Users see prices that no longer exist" ],
            [ "Who waits for whom?", "Messaging & Streams", "A slow consumer stalls the checkout" ],
            [ "What do we agree on?", "Consistency & Coordination", "Two nodes both think they lead" ],
            [ "How do parts talk?", "Networking & APIs", "A version bump breaks four teams" ],
            [ "What happens when a part is gone?", "Reliability & Operations", "One timeout takes everything down" ],
            [ "How does it get there?", "Platform & Deployment", "A release is an event, not a Tuesday" ]
          ]
        }
      },
      {
        block_type: "node_reference",
        data: { "title" => "Start with the constraint", "node_title" => "CAP Theorem", "label" => "Everything else is downstream of this" }
      },
      {
        block_type: "url",
        data: { "url" => "https://github.com/donnemartin/system-design-primer", "label" => "System Design Primer", "kind" => "reference" }
      }
    ]
  }
].freeze

# ---------------------------------------------------------------------- rung 1: the areas
AREA_NODES = [
  {
    title: "Scaling & Load",
    summary: "Getting more work through the system than one machine can do.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Two ways to serve more traffic: make the machine bigger, or make more
            machines. The first is bounded and cheap to reason about; the second is
            unbounded and drags in every other area here -- load has to be *spread*, and
            the moment it is spread, state has to be shared or partitioned.

            Scaling work is mostly the work of removing shared mutable state from the
            request path.
          MD
        }
      },
      {
        block_type: "table",
        data: {
          "title" => "Little's Law, applied",
          "columns" => [ "Arrival rate", "Latency", "Concurrency needed" ],
          "rows" => [
            [ "100 rps", "50 ms", "5 in flight" ],
            [ "100 rps", "500 ms", "50 in flight" ],
            [ "1000 rps", "500 ms", "500 in flight" ]
          ]
        }
      }
    ]
  },
  {
    title: "Data Storage",
    summary: "Where the truth lives, how it survives a lost disk, and how it is found again.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            A store answers three questions that pull against each other: how a write is
            made durable, how reads are made fast, and how the data outgrows one disk.

            Durability is the write-ahead log. Speed is the index. Growth is replication
            and sharding. Nearly every database on rung four is a different opinion about
            how to combine those three.
          MD
        }
      }
    ]
  },
  {
    title: "Caching",
    summary: "Trading freshness for latency, on purpose and with an expiry.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            A cache is a second, faster, *wrong* copy of the data. It is worth having when
            the read-to-write ratio is high and the reader tolerates an answer that was
            true a moment ago.

            The hard part is never the lookup. It is deciding when a copy stops being
            acceptable, and what the system does at the instant a popular copy expires.
          MD
        }
      },
      {
        block_type: "text",
        data: { "text" => "Rule of thumb: if you cannot say how stale a value is allowed to be, you are not ready to cache it." }
      }
    ]
  },
  {
    title: "Messaging & Streams",
    summary: "Work handed over instead of waited on.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Asynchrony buys three things: the caller returns before the work is done, a
            slow consumer cannot stall a fast producer, and a consumer can be down for an
            hour without anything being lost.

            It costs one thing, and the cost is large: nothing is exactly-once. Every
            consumer must be safe to run twice on the same message.
          MD
        }
      }
    ]
  },
  {
    title: "Consistency & Coordination",
    summary: "Getting independent machines to agree, and paying for it.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Coordination is the most expensive thing a distributed system can do, and the
            skill is in needing less of it. A design that requires every node to agree on
            every write has chosen the latency of its slowest quorum member as its floor.

            Most of the techniques here are ways to *avoid* agreement: partition so writes
            are single-owner, make operations idempotent so order stops mattering, or
            accept an ordering that is merely eventually the same everywhere.
          MD
        }
      }
    ]
  },
  {
    title: "Networking & APIs",
    summary: "The contracts and the wires between the parts.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Two services are coupled by the shape of what passes between them, not by the
            transport that carries it. Which is why the durable decisions here are about
            schemas, compatibility and deadlines -- and why the choice between REST and
            gRPC matters less than teams argue.

            The network itself contributes exactly one fact worth memorising: it will
            fail, partially, in the middle of a request, and the caller cannot tell that
            apart from a slow success.
          MD
        }
      }
    ]
  },
  {
    title: "Reliability & Operations",
    summary: "Behaving predictably while parts of the system are missing.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Failure is not an exceptional state at scale; at any moment something is
            timing out. Reliability is therefore not about preventing failure but about
            keeping it local: a dependency that is down should degrade one feature, not
            saturate every thread in the caller.

            It is also the only area that makes you write down a number. Without a target,
            "fast enough" and "up" are opinions.
          MD
        }
      },
      {
        block_type: "table",
        data: {
          "title" => "What an availability target costs you",
          "columns" => [ "Target", "Downtime per month", "Implies" ],
          "rows" => [
            [ "99%", "7h 18m", "One box, business-hours care" ],
            [ "99.9%", "43m", "Redundancy, automated deploys" ],
            [ "99.99%", "4m 19s", "Multi-zone, no manual failover" ],
            [ "99.999%", "26s", "No human in the recovery path" ]
          ]
        }
      }
    ]
  },
  {
    title: "Platform & Deployment",
    summary: "How the code reaches machines, and how those machines are replaced.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Everything above assumes you can replace a running process without anyone
            noticing. That assumption is a whole area of its own: images, schedulers,
            rollouts, and a description of the infrastructure that lives in version
            control rather than in somebody's console history.

            The measure of maturity is not the tooling. It is whether a release is a
            decision somebody has to be brave about.
          MD
        }
      }
    ]
  },
  {
    title: "Failure Modes",
    summary: "The named ways distributed systems come apart, and what answers each.",
    metadata: { "kind" => "area" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            These are not an appendix. Most of the mechanisms in the other areas exist
            because one of these happened to somebody, and knowing the failure by name is
            what turns an incident into a design review.

            Each one here is wired to what causes it and what mitigates it, so the graph
            can be read backwards: from the symptom you are seeing to the technique you
            are missing.
          MD
        }
      }
    ]
  }
].freeze

# ------------------------------------------------------------------- rung 2: the concepts
CONCEPT_NODES = [
  # -- Scaling & Load
  one.("Horizontal Scaling", "concept",
       "More machines rather than bigger ones, which only works for stateless work.",
       "Adding machines only adds throughput for work that shares nothing. The instant a request depends on in-memory state, the second machine is not a copy -- it is a new correctness problem, and the state has to move into a store, a cache, or a partition owner."),
  {
    title: "Load Balancing",
    summary: "Choosing which replica serves each request, and noticing when one should not.",
    blocks: [
      {
        block_type: "table",
        data: {
          "title" => "Picking a strategy",
          "columns" => [ "Strategy", "Good when", "Fails when" ],
          "rows" => [
            [ "Round robin", "Requests cost the same", "One request is 100x another" ],
            [ "Least connections", "Costs vary widely", "A slow backend looks idle" ],
            [ "Consistent hash", "Backends hold per-key state", "Keys are skewed" ],
            [ "Power of two choices", "You want most of the above, cheaply", "Rarely" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Half of load balancing is health checking. A balancer that keeps sending traffic to a process which accepts connections but cannot serve them is worse than no balancer, because it spreads the failure evenly." }
      }
    ]
  },
  one.("Rate Limiting", "concept",
       "Refusing work early, so the work you accept still completes.",
       "A limit is a promise about the worst case. Rejecting a tenth of traffic with a clear 429 and a Retry-After is a better outcome than serving all of it at thirty seconds a request, because an unbounded queue turns a capacity problem into an outage."),
  one.("Edge Delivery", "concept",
       "Serving bytes from near the user, where the latency is distance rather than work.",
       "For a reader 10,000 km away most of the response time is the speed of light and connection setup, not your database: a round trip London to Sydney is about 250 ms before your code runs. Moving bytes closer removes latency no amount of backend tuning can."),
  one.("Connection Pooling", "concept",
       "Reusing a small number of expensive connections instead of opening one per request.",
       "A PostgreSQL connection is a process with megabytes of memory, so a fleet of 50 pods with 25 threads each does not get 1,250 connections -- it gets a database that spends its time context switching. The pool is where you decide that queueing for a connection is cheaper than having one."),

  # -- Data Storage
  {
    title: "Replication",
    summary: "The same data on several machines: read throughput and survivability, at a price.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            One primary and N followers is the common shape. Reads scale with followers;
            writes do not scale at all, because they still go through one machine.

            The decision that matters is whether a write waits for followers. Synchronous
            replication means no acknowledged write is ever lost and every write pays the
            slowest follower. Asynchronous means fast writes and a window in which a
            failover loses data.
          MD
        }
      },
      {
        block_type: "json",
        data: {
          "title" => "The knob, as configuration",
          "value" => {
            "mode" => "semi_synchronous",
            "acks_required" => 1,
            "replicas" => 3,
            "max_lag_before_removal_seconds" => 30,
            "reads_from_followers" => true
          }
        }
      }
    ]
  },
  {
    title: "Sharding",
    summary: "Splitting one dataset across machines by key, so writes scale too.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Replication copies everything; sharding splits it. That makes write throughput
            grow with machines, and takes away the two things a single database gave you
            for free: a join across the whole dataset, and a transaction spanning it.

            Choosing the key *is* the design. A key that groups a tenant's rows together
            keeps queries local and makes the largest tenant a hot spot; a key that
            scatters them evens out load and makes every query a fan-out.
          MD
        }
      }
    ]
  },
  {
    title: "Indexing",
    summary: "A second structure that answers a question without reading everything.",
    blocks: [
      {
        block_type: "code",
        data: {
          "title" => "An index is a statement about the queries you run",
          "language" => "sql",
          "code" => <<~SQL
            -- Partial and composite, because the operational question is always
            -- "what is still open for this account", and closed rows are 99% of
            -- the table within a year.
            CREATE INDEX index_orders_open_by_account
              ON orders (account_id, placed_at DESC)
              WHERE status IN ('pending', 'paid');
          SQL
        }
      },
      {
        block_type: "text",
        data: { "text" => "Every index is paid for on write and in storage. An index nobody queries is pure cost, which is why the honest way to review them is against the query log rather than against intuition." }
      }
    ]
  },
  {
    title: "Storage Engines",
    summary: "How bytes actually reach a disk, and which access pattern that favours.",
    blocks: [
      {
        block_type: "table",
        data: {
          "title" => "Two answers to the same problem",
          "columns" => [ "", "B-tree", "LSM tree" ],
          "rows" => [
            [ "Writes", "In place, random", "Appended, sequential" ],
            [ "Reads", "One lookup path", "May check several levels" ],
            [ "Cost paid later", "Page splits, fragmentation", "Compaction" ],
            [ "Typical of", "PostgreSQL, InnoDB", "Cassandra, RocksDB" ]
          ]
        }
      }
    ]
  },
  {
    title: "Data Models",
    summary: "Relational, document, key-value, wide-column, graph, columnar -- and what each refuses to do.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Model", "Natural question", "Awkward question" ],
          "rows" => [
            [ "Relational", "Anything, once normalised", "Millions of writes per second" ],
            [ "Document", "Give me this whole aggregate", "Join across aggregates" ],
            [ "Key-value", "Give me this key, now", "Anything not keyed" ],
            [ "Wide-column", "This partition, in order", "Ad-hoc filters" ],
            [ "Graph", "How are these two connected?", "Aggregate over everything" ],
            [ "Columnar", "Sum a billion rows", "Update one row" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The model is a bet about your access patterns, and it is the hardest thing to change later. Start relational unless you can name the query that relational cannot serve." }
      }
    ]
  },
  one.("Object Storage", "concept",
       "Immutable blobs behind an HTTP API, priced like a utility.",
       "Not a filesystem: no rename, no append, no directory -- a flat keyspace where the only operations are put, get and delete of a whole object. Giving those up is what buys eleven nines of durability and a price per gigabyte a block device cannot approach."),

  # -- Caching
  {
    title: "Cache Placement",
    summary: "Where the copy lives: in the process, beside it, or at the edge.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Placement", "Latency", "Problem" ],
          "rows" => [
            [ "In-process", "Nanoseconds", "N copies, N different truths" ],
            [ "Shared tier", "Sub-millisecond", "A network hop, and a new dependency" ],
            [ "Reverse proxy", "Microseconds at the front door", "Only whole responses" ],
            [ "Edge / CDN", "Tens of ms to the user", "Invalidation is far away" ]
          ]
        }
      }
    ]
  },
  {
    title: "Cache Invalidation",
    summary: "Deciding when a copy stops being an acceptable answer.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            Three strategies, in increasing order of how much they can hurt you:

            1. **Expiry.** Wrong for a bounded time, and trivially correct to implement.
            2. **Write-through or delete-on-write.** Fresh, until a write fails halfway
               and the cache and the store disagree with nobody watching.
            3. **Event-driven.** Fresh and decoupled, and now cache correctness depends on
               a message bus being healthy.

            Expiry is underrated. It is the only one of the three whose failure mode is
            known in advance.
          MD
        }
      }
    ]
  },
  one.("Eviction Policies", "concept",
       "What to throw away when a fixed-size cache is full.",
       "Eviction is a guess about the future from the shape of the past: recency assumes what was just used will be used again, frequency assumes long-run popularity wins. The workload decides which guess is right, and one scan over cold data breaks recency badly."),

  # -- Messaging & Streams
  one.("Message Queues", "queue",
       "Point-to-point handover: each job is done by exactly one worker, eventually.",
       "A queue converts a latency problem into a backlog problem, which is progress: a backlog is visible, measurable and survivable. Watch queue depth and oldest-message age, because mean processing time hides the one consumer that stopped."),
  one.("Publish and Subscribe", "concept",
       "One event, many independent readers, none of which the publisher knows about.",
       "The publisher's ignorance is the feature: a fourth consumer can be added without touching the code that emits the event. It is also the cost -- nobody can tell you, from the publisher's source, what happens after a publish."),
  {
    title: "Delivery Guarantees",
    summary: "At-most-once, at-least-once, and the exactly-once that is really two mechanisms.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Guarantee", "How", "You still must handle" ],
          "rows" => [
            [ "At most once", "Fire and forget", "Lost work" ],
            [ "At least once", "Ack after processing, redeliver on timeout", "Duplicates" ],
            [ "\"Exactly once\"", "At least once plus deduplication", "The dedupe window expiring" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "There is no exactly-once delivery over a network that can drop the acknowledgement. There is only exactly-once *effect*, which the consumer provides by being idempotent." }
      }
    ]
  },
  {
    title: "Event Sourcing",
    summary: "Storing what happened, and deriving current state from it.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            The log of changes becomes the system of record, and the row you would have
            updated becomes a projection you can rebuild.

            This is how you get an audit trail for free, and how you answer questions
            nobody thought to ask when the schema was written. It is also how you inherit
            a versioning problem that never goes away: events are permanent, so every
            reader must cope with every shape an event has ever had.
          MD
        }
      }
    ]
  },
  one.("Stream Processing", "concept",
       "Continuous computation over an unbounded log, with windows instead of batches.",
       "The awkward question in every stream job is time: events arrive late, out of order, and sometimes after the window they belong to has been reported. Event time with a watermark is the honest model; processing time is the convenient one."),
  one.("Change Data Capture", "concept",
       "Turning a database's own write log into an event stream.",
       "The alternative -- having the application write to the database and publish an event -- has no atomic step, so the two diverge on every crash. Reading the log the database already wrote means the stream cannot disagree with the table, because it is derived from it."),

  # -- Consistency & Coordination
  {
    title: "CAP Theorem",
    summary: "While the network is partitioned, a system may stay consistent or stay available.",
    metadata: { "kind" => "constraint" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            The useful reading is not "pick two of three". Partitions are not a choice --
            they happen. The theorem says what you must decide **in advance** about the
            minutes while one is happening:

            - **CP:** refuse writes on the minority side. Correct, and partly down.
            - **AP:** accept writes everywhere and reconcile later. Up, and temporarily
              disagreeing with itself.

            A system that has not decided will discover its answer during an incident,
            which is the worst possible time to find out.
          MD
        }
      },
      {
        block_type: "table",
        data: {
          "title" => "The same product, both ways",
          "columns" => [ "Operation", "CP choice", "AP choice" ],
          "rows" => [
            [ "Take payment", "Refuse -- double charges are unforgivable", "-" ],
            [ "Add to cart", "-", "Accept -- a merged cart is fine" ],
            [ "Read a product page", "-", "Accept -- stale is fine" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "PACELC is the sharper version: else, when there is no partition, you are still trading latency against consistency on every single request." }
      }
    ]
  },
  {
    title: "Consistency Models",
    summary: "The ladder from linearizable to eventual, and what each one lets you stop checking.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Model", "Promise", "Cost" ],
          "rows" => [
            [ "Linearizable", "Reads see the latest write, always", "A quorum round trip per operation" ],
            [ "Sequential", "Everyone sees one order", "Still coordination" ],
            [ "Causal", "Cause is seen before effect", "Metadata per write" ],
            [ "Read-your-writes", "You see your own change", "Sticky routing or a version token" ],
            [ "Eventual", "Copies converge, given quiet", "Application must tolerate conflict" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Most user-visible complaints about \"eventual consistency\" are really read-your-writes complaints, and those are fixable with a session token rather than with a stronger store." }
      }
    ]
  },
  one.("Consensus", "concept",
       "A group of machines agreeing on one value despite some of them being gone.",
       "Consensus is what you use to decide who the leader is, not what you use on the request path. Almost every design that puts agreement into each write is really asking for a single owner per key instead."),
  {
    title: "Isolation Levels",
    summary: "How much of another in-flight transaction a transaction is allowed to see.",
    blocks: [
      {
        block_type: "table",
        data: {
          "title" => "What each level still permits",
          "columns" => [ "Level", "Dirty read", "Non-repeatable read", "Phantom / write skew" ],
          "rows" => [
            [ "Read committed", "No", "Yes", "Yes" ],
            [ "Repeatable read", "No", "No", "Write skew possible" ],
            [ "Serializable", "No", "No", "No, at the cost of aborts" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Most applications run at read committed and contain at least one invariant that silently requires serializable. The usual fix is not a stronger level but an explicit lock or a uniqueness constraint on the thing being protected." }
      }
    ]
  },
  one.("Distributed Transactions", "concept",
       "One outcome across several stores, none of which can see the others.",
       "Two options, and neither is free: block until everyone commits, or let each step commit alone and write the compensation for every step that might have to be undone. The third option -- usually the right one -- is to redraw the boundary so the transaction fits in one store."),
  {
    title: "Idempotency",
    summary: "Doing the same operation twice leaves the same result as doing it once.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            The quiet keystone of distributed systems. A caller that times out cannot tell
            a lost request from a lost response, so it must retry; retries are only safe
            if the receiver can absorb a duplicate.

            In practice that means a client-supplied key, stored with the result:

            ```
            POST /payments
            Idempotency-Key: 8f14e45f-ea3f-4ba1-9f21-b0de1e70a5cb
            ```

            A second request with the same key returns the first result, and charges
            nobody twice.
          MD
        }
      }
    ]
  },
  one.("Leases and Locks", "concept",
       "Exclusive access that expires, because a holder may simply vanish.",
       "A lock without a timeout is an outage waiting for a crashed holder; a lock with a timeout can be held by two processes at once when the first one merely paused. Which is why the durable version of this is a lease plus a fencing token the resource itself checks."),
  one.("Clocks and Ordering", "concept",
       "Wall clocks disagree, so ordering has to come from somewhere else.",
       "Two machines' clocks differ by milliseconds at best and minutes at worst, so \"latest timestamp wins\" quietly loses writes. Ordering that survives comes from a sequence a single owner assigns, or from counters that record causality rather than time."),

  # -- Networking & APIs
  {
    title: "API Styles",
    summary: "REST, gRPC and GraphQL answer different questions about who shapes the response.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Style", "Response shaped by", "Best at" ],
          "rows" => [
            [ "REST", "The server, per resource", "Cacheable public interfaces" ],
            [ "gRPC", "A shared schema", "Service-to-service, high volume" ],
            [ "GraphQL", "The client, per query", "Many clients, one aggregating backend" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The style is not the coupling. Whatever you pick, the compatibility rules are the same: add optional fields, never repurpose one, and never make a field required after the fact." }
      }
    ]
  },
  one.("HTTP and TLS", "concept",
       "The transport almost everything ends up speaking, and the handshake in front of it.",
       "Head-of-line blocking, keep-alive, and how many round trips a cold connection costs are all decided here: TLS 1.3 gets a new connection to first byte in one round trip instead of two, which on a 150 ms link is the difference users describe as a slow site."),
  one.("Service Discovery", "concept",
       "Finding the current address of something that moves.",
       "In a fleet where pods are replaced hourly, a hostname in a config file is a stale fact with a deploy cycle. Discovery replaces it with a lookup against something that knows the current membership -- and inherits that thing's caching and TTL behaviour, which is where the surprises live."),
  one.("Service Mesh", "concept",
       "Moving retries, timeouts, mTLS and telemetry out of the application and into a proxy.",
       "The appeal is uniformity: one place to set a timeout policy for forty services in six languages. The cost is a second network hop, a second thing to debug, and a control plane that is now on the critical path of every deploy."),
  one.("Real-time Transport", "concept",
       "Keeping a connection open so the server can speak first.",
       "Polling turns a rare event into constant load; a held connection turns it into a push at the cost of state per client. The decision is usually how many clients times how much memory per connection, and whether a proxy in between will tolerate a socket open for hours."),
  {
    title: "Serialization",
    summary: "How a structure becomes bytes, and whether tomorrow's reader understands today's bytes.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Format", "Schema", "Good for" ],
          "rows" => [
            [ "JSON", "None, by convention", "Public APIs, debuggability" ],
            [ "Protocol Buffers", "Compiled, field-numbered", "Internal RPC, small payloads" ],
            [ "Avro", "Carried or registered", "Long-lived logs and analytics" ],
            [ "MessagePack", "None", "JSON's shape, fewer bytes" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The format matters far less than the discipline: field numbers are forever, defaults are how old readers survive new writers, and a schema registry is how you find out at deploy time rather than at 3am." }
      }
    ]
  },

  # -- Reliability & Operations
  {
    title: "Circuit Breaker",
    summary: "Failing fast on a dependency that is already failing.",
    blocks: [
      {
        block_type: "json",
        data: {
          "title" => "The three states, and the numbers that move between them",
          "value" => {
            "closed" => { "behaviour" => "pass through", "opens_after" => "50% errors in 20 requests" },
            "open" => { "behaviour" => "reject immediately", "stays_for_seconds" => 30 },
            "half_open" => { "behaviour" => "let one request through", "closes_after" => "3 successes" }
          }
        }
      },
      {
        block_type: "text",
        data: { "text" => "Without a breaker, a dependency that takes 30 seconds to time out will consume every thread in the caller and turn one team's outage into everyone's." }
      }
    ]
  },
  one.("Retries and Backoff", "concept",
       "Trying again in a way that helps recovery instead of preventing it.",
       "Immediate retries are an amplifier: the moment a service slows down, every caller triples its load on it. Retries need a ceiling, a budget, and jitter -- and they need the operation to be idempotent, or a retry is a second side effect."),
  one.("Timeouts and Deadlines", "concept",
       "Deciding how long to wait before deciding, and telling everyone downstream.",
       "A default timeout of infinity is the most common reliability bug in production. A timeout per hop is better; a deadline set once at the edge and carried down every call is better still, because it is the only version where the total is bounded."),
  one.("Load Shedding", "concept",
       "Dropping the least valuable work so the rest still meets its deadline.",
       "Past saturation, accepting everything means finishing nothing: every request sits in a queue longer than its own timeout and is thrown away after being paid for. Shedding early -- by priority, by queue depth, by measured latency -- is how throughput stays flat instead of collapsing."),
  {
    title: "Observability",
    summary: "Being able to answer a question about production you did not anticipate.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Signal", "Answers", "Weakness" ],
          "rows" => [
            [ "Metrics", "Is something wrong, since when", "Cannot tell you which request" ],
            [ "Logs", "What happened to this one request", "Expensive, unstructured by default" ],
            [ "Traces", "Where the time went across services", "Sampling hides the rare case" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Report percentiles, never averages. An average hides the tail, and the tail is the part users describe as \"it's broken\"." }
      }
    ]
  },
  {
    title: "Service Level Objectives",
    summary: "A written number that makes \"fast enough\" falsifiable.",
    blocks: [
      {
        block_type: "table",
        data: {
          "title" => "An objective has all four columns or it is a wish",
          "columns" => [ "Journey", "Target", "Window", "Measured at" ],
          "rows" => [
            [ "Read a page", "p95 < 300 ms", "28 days", "Edge" ],
            [ "Submit a form", "p99 < 2 s", "28 days", "API gateway" ],
            [ "Any request", "99.9% non-5xx", "28 days", "Load balancer" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The error budget is the point: 99.9% over 28 days is 40 minutes of failure you are allowed to spend. Spent deliberately on releases, it is how a team ships; never spent, it is a sign the target is too low to inform any decision." }
      }
    ]
  },
  one.("Capacity Planning", "concept",
       "Knowing the number of machines the next order of magnitude needs, before it arrives.",
       "Two inputs and no guesswork: a measured cost per request and a forecast of requests. What breaks the arithmetic is that cost per request is not constant -- it rises with contention -- so the honest way to get the number is to push a copy of production until something bends."),

  # -- Platform & Deployment
  one.("Containers", "concept",
       "Shipping the filesystem with the process, so \"works here\" transfers.",
       "The image is the unit of deployment and the unit of reproducibility: same bytes in test and production, started in milliseconds. What it is not is isolation in the security sense -- shared kernel, shared page cache, and a noisy neighbour is still a neighbour."),
  one.("Orchestration", "concept",
       "Declaring what should be running and letting a controller keep it true.",
       "The shift is from imperative to declarative: you stop saying \"start two more\" and start saying \"there are eight\", and a loop notices the difference. Everything good about it and everything confusing about it follows from that loop running without you."),
  one.("Autoscaling", "concept",
       "Changing the number of instances in response to a signal.",
       "The signal is the whole design. CPU is easy and lags badly; queue depth or in-flight requests track the actual backlog; a schedule beats both for traffic you already know is coming. And scaling out only helps if the thing you scale is not waiting on a database that did not."),
  {
    title: "Deployment Strategies",
    summary: "Replacing running code while it is serving, and being able to undo it.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Strategy", "Blast radius", "Costs" ],
          "rows" => [
            [ "Rolling", "A fraction at a time", "Two versions live at once" ],
            [ "Blue-green", "All or nothing, instantly reversible", "Double the capacity" ],
            [ "Canary", "1% of users, then 10%", "Needs per-slice metrics to be worth it" ],
            [ "Feature flag", "Per user, no deploy", "Flags outlive the reason for them" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Every one of these assumes two versions of the code can run against one database, which makes the schema migration -- not the rollout -- the part that needs the plan." }
      }
    ]
  },
  one.("Infrastructure as Code", "concept",
       "The infrastructure described in a file, applied by a tool, reviewed like code.",
       "The value is not automation, it is the diff: a change to a load balancer becomes something a second person can read before it happens, and a rebuild after a region loss becomes a command rather than an archaeology project. Drift is the failure mode -- anything changed by hand is a lie in the file."),
  one.("Multi-Region", "concept",
       "Running in places far enough apart that the speed of light is a design input.",
       "Active-passive buys survival and costs a failover drill nobody runs often enough. Active-active buys latency for users on both continents and forces you to answer, per table, what happens when both sides write -- which is why most multi-region systems are single-writer with local reads."),

  # -- Failure Modes
  one.("Hot Shard", "concept",
       "One partition takes a disproportionate share of traffic, and the cluster looks idle.",
       "Almost always the key. Tenant-keyed data has one tenant fifty times the median; time-keyed data puts all of today's writes on one shard. The fixes are to salt the key, to split the outlier onto its own shard, or to cache in front of it -- in that order of preference.",
       { "kind" => "failure mode" }),
  {
    title: "Thundering Herd",
    summary: "A popular key expires and every request for it hits the store at once.",
    metadata: { "kind" => "failure mode" },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            One key, a thousand readers a second, a five-minute expiry: for the few hundred
            milliseconds after it expires, every one of those readers misses and recomputes
            the same value.

            Three fixes, all cheap:

            - A short lock, so exactly one request recomputes and the rest wait.
            - Recompute *before* expiry, in the background.
            - Randomise the expiry, so a thousand keys do not fall due together.
          MD
        }
      },
      {
        block_type: "node_reference",
        data: { "node_title" => "Idempotency", "label" => "Why the retries a herd generates must be safe" }
      }
    ]
  },
  one.("Cascading Failure", "concept",
       "One slow dependency consumes every caller's threads, and the slowness spreads upstream.",
       "The mechanism is always the same: a dependency slows, callers hold connections open waiting, their pools fill, their own callers start waiting, and a component that was healthy is now the thing paging you. Timeouts, breakers and bulkheads exist entirely to interrupt this chain.",
       { "kind" => "failure mode" }),
  one.("Split Brain", "concept",
       "Two nodes both believe they are the leader, and both accept writes.",
       "A partition plus a failover with no quorum requirement is enough. The damage is done after the network heals, when two divergent histories have to be merged by someone who was not there -- which is why a majority vote and a fencing token are non-negotiable rather than nice to have.",
       { "kind" => "failure mode" }),
  one.("Retry Storm", "concept",
       "A blip makes every client retry at once, and the retries are now the outage.",
       "Traffic multiplies by the retry count exactly when the system has least headroom, and synchronised clients keep it multiplied. Jitter, a retry budget as a fraction of live traffic, and a breaker that stops the retries entirely are the three answers.",
       { "kind" => "failure mode" }),
  one.("Head-of-Line Blocking", "concept",
       "One slow item at the front holds up everything behind it in a strictly ordered channel.",
       "It appears at every layer: one large HTTP/1.1 response on a connection, one poison message in a partition, one long query on a single-threaded server. The fix is always to break the ordering requirement -- more partitions, more connections, a separate queue for the slow class of work.",
       { "kind" => "failure mode" }),
  one.("Clock Skew", "concept",
       "Two machines disagree about the time, and something ordered by timestamp goes wrong.",
       "Symptoms look unrelated to clocks: tokens rejected as expired seconds after issue, last-write-wins silently dropping the later write, a log where the response precedes the request. Treat any ordering that depends on wall time across hosts as a bug with a latency-shaped trigger.",
       { "kind" => "failure mode" }),
  one.("Data Loss on Failover", "concept",
       "The promoted replica had not received the last writes the old primary acknowledged.",
       "This is the bill for asynchronous replication, and it arrives as rows that a user watched succeed and that no longer exist. The only real controls are the acknowledgement policy and the lag you allow a candidate to have before it is eligible to be promoted.",
       { "kind" => "failure mode" }),
  one.("Backlog Explosion", "concept",
       "Producers keep producing while consumers are stalled, and the queue grows without bound.",
       "A queue absorbs a spike; it does not absorb a rate mismatch. Once the backlog exceeds what consumers can drain before the data stops being useful, the only choices are shedding, more consumers, or admitting the work was never worth doing -- and that decision is much easier with oldest-message age on a dashboard.",
       { "kind" => "failure mode" })
].freeze

# ----------------------------------------------------------------- rung 3: the mechanisms
MECHANISM_NODES = [
  # -- under Scaling & Load
  one.("Stateless Services", "concept",
       "Keeping nothing in the process that a second copy of the process would need.",
       "Session in a cookie or a shared store, uploads straight to object storage, no in-memory counters that matter. The test is brutal and simple: kill any instance mid-traffic and no user should be able to tell which one you killed."),
  one.("Sticky Sessions", "concept",
       "Pinning a client to one backend, which is a compromise rather than a design.",
       "It makes an in-memory cache or an open socket work without shared state, and in exchange every deploy drops somebody's session and one popular tenant can pin itself to one machine. Useful as a stepping stone, dangerous as a foundation."),
  one.("Layer 4 and Layer 7", "concept",
       "Balancing on connections, or on the requests inside them.",
       "A layer 4 balancer moves packets and cannot see a URL; it is cheap and it cannot retry. A layer 7 balancer parses HTTP, so it can route by path, retry an idempotent GET, and enforce a timeout -- at the cost of terminating the connection and becoming a thing that can be CPU-bound."),
  {
    title: "Consistent Hashing",
    summary: "Mapping keys to machines so adding one moves 1/N of the keys, not all of them.",
    metadata: { "note" => "Belongs to load balancing and to sharding; the same trick answers both." },
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            `hash(key) % n` is fine until `n` changes, at which point nearly every key
            moves and every cache in the fleet misses at once.

            Place both keys and nodes on a ring instead, and a key belongs to the next node
            clockwise. Adding a node steals keys from exactly one neighbour. Virtual nodes
            -- a hundred ring positions per machine -- are what make the split even rather
            than lumpy.
          MD
        }
      },
      {
        block_type: "code",
        data: {
          "title" => "The ring, minus the bookkeeping",
          "language" => "ruby",
          "code" => <<~'RUBY'
            # Each machine appears at many points on the ring, so removing one
            # spreads its keys over all the others instead of dumping them on
            # a single neighbour.
            ring = servers.flat_map { |s| (0...150).map { |i| [ hash("#{s}-#{i}"), s ] } }.sort

            def owner(ring, key)
              point = hash(key)
              slot = ring.bsearch { |position, _| position >= point }
              (slot || ring.first).last
            end
          RUBY
        }
      }
    ]
  },
  one.("Health Checking", "concept",
       "Asking a backend whether it can work, not whether it is listening.",
       "A TCP connect succeeds while the app is deadlocked, so the check has to exercise something real -- and then distinguish liveness (restart me) from readiness (do not send me traffic yet). Getting that pair wrong is how a rolling deploy takes down a service that never actually broke."),
  {
    title: "Token Bucket",
    summary: "A refilling allowance that permits bursts up to its size and no more on average.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "ruby",
          "code" => <<~RUBY
            # Tokens are computed from elapsed time rather than topped up by a
            # background job, so there is nothing to run and nothing to drift.
            def allow?(bucket, now, rate:, size:)
              bucket.tokens = [ bucket.tokens + (now - bucket.last_seen) * rate, size ].min
              bucket.last_seen = now
              return false if bucket.tokens < 1

              bucket.tokens -= 1
              true
            end
          RUBY
        }
      },
      {
        block_type: "text",
        data: { "text" => "Size is the burst a client may take; rate is what it may sustain. A leaky bucket smooths instead, which is what you want for outbound calls into somebody else's rate-limited API." }
      }
    ]
  },
  one.("Sliding Window Counter", "concept",
       "Counting requests over a moving window instead of a calendar minute.",
       "A fixed window lets a client spend its whole minute's quota in the last second and the next minute's in the first, which is twice the intended rate across the boundary. Two adjacent buckets, weighted by how far into the window you are, fixes it for one counter's worth of memory."),
  one.("Anycast and Points of Presence", "concept",
       "One address announced from many places, so the network picks the nearest.",
       "The same IP is advertised from hundreds of sites and BGP routes each user to the closest one, which is why an edge provider needs no DNS trickery to be local. It also means a point of presence can be drained by withdrawing a route, and traffic simply arrives somewhere else."),
  {
    title: "HTTP Cache Headers",
    summary: "Cache-Control, ETag and the revalidation dance, which most caches obey for free.",
    metadata: { "note" => "The one invalidation mechanism that spans your cache, every proxy and every browser." },
    blocks: [
      {
        block_type: "code",
        data: {
          "title" => "Stale-while-revalidate is the underused one",
          "language" => "http",
          "code" => <<~HTTP
            Cache-Control: public, max-age=60, stale-while-revalidate=600
            ETag: "a9f3c1"

            # For 60 seconds: served from cache.
            # For the next 10 minutes: served stale *immediately*, refreshed in the
            # background. The user never waits for your origin, and your origin
            # never sees a herd at the moment of expiry.
          HTTP
        }
      }
    ]
  },
  one.("Transaction Pooling", "concept",
       "Handing a database connection back after every transaction rather than every request.",
       "It multiplies how many clients one connection serves, and it takes away everything that lives on a session: prepared statements, advisory locks, `SET` for the rest of the request. PgBouncer in transaction mode is the usual shape, and the usual first surprise."),

  # -- under Data Storage
  one.("Leader and Followers", "concept",
       "One machine orders the writes, others copy that order.",
       "Everything hard about replication is in the promotion. Who notices the leader is gone, who decides, how the old leader is stopped from continuing to accept writes when it comes back -- and whether the candidate with the most data is the one that wins."),
  {
    title: "Write-Ahead Log",
    summary: "Record the intent durably before touching the data, and recovery becomes a replay.",
    metadata: { "note" => "The same log is both the durability mechanism and the replication stream." },
    blocks: [
      {
        block_type: "text",
        data: { "text" => "A crash halfway through updating a page is unrecoverable if the page was the only record of the change. Append the change to a sequential log first, fsync it, and the page can be rebuilt afterwards. That the log also happens to be exactly what a follower needs -- and exactly what change data capture reads -- is why one mechanism sits under three concepts." }
      }
    ]
  },
  {
    title: "Quorum Reads and Writes",
    summary: "With R + W > N, a read is guaranteed to see the newest acknowledged write.",
    blocks: [
      {
        block_type: "json",
        data: {
          "title" => "Tuning the same cluster three ways",
          "value" => [
            { "n" => 3, "w" => 3, "r" => 1, "reads" => "fast and fresh", "writes" => "no replica may be down" },
            { "n" => 3, "w" => 2, "r" => 2, "reads" => "balanced", "writes" => "balanced" },
            { "n" => 3, "w" => 1, "r" => 3, "reads" => "slow", "writes" => "fast, may be lost" }
          ]
        }
      }
    ]
  },
  one.("Read Replicas and Lag", "concept",
       "Serving reads from a copy that is a few milliseconds -- or a few minutes -- behind.",
       "Lag is fine until a user writes and immediately reads, sees their change missing, and writes it again. The fix is not a faster replica: it is routing that request to the primary, or carrying the write's position and waiting for a replica to reach it."),
  one.("Range and Hash Partitioning", "concept",
       "Splitting by contiguous key ranges, or by the hash of the key.",
       "Ranges keep neighbouring keys together, so scans and time-series queries stay on one shard -- and so do all of today's writes. Hashing scatters them, which evens out load and turns every range query into a fan-out. Pick by which of those two queries you actually run."),
  one.("Resharding and Backfill", "concept",
       "Changing the partition count on a dataset that is being written to.",
       "The migration, not the scheme, is what makes sharding expensive: dual-write or log-follow into the new layout, backfill history, verify row by row, flip reads, and keep the rollback path alive throughout. Budget weeks, and pick the initial key as if you will never get to do this."),
  one.("B-Tree", "concept",
       "Fixed-size pages, updated in place, four levels deep for a billion rows.",
       "High fan-out keeps the tree shallow, so any row is a handful of page reads away and range scans follow the leaves in order. The cost is random writes: a page split in the middle of a busy index is the price of keeping reads this predictable."),
  one.("LSM Tree", "concept",
       "Buffer writes in memory, flush sorted files, merge them in the background.",
       "Every write is sequential, which is why write-heavy stores choose this shape. Reads may have to consult several files, and the deferred merge -- compaction -- is real work that shows up later as I/O nobody scheduled."),
  {
    title: "Bloom Filter",
    summary: "A few bits per key that can say \"definitely not here\" and never \"definitely here\".",
    blocks: [
      {
        block_type: "table",
        data: {
          "title" => "Bits per key against false positive rate",
          "columns" => [ "Bits per key", "Hashes", "False positives" ],
          "rows" => [
            [ "5", "3", "~9%" ],
            [ "10", "7", "~1%" ],
            [ "20", "14", "~0.01%" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "One-sided error is the whole trick: a negative is certain, so the filter skips a disk read entirely, and a rare false positive only costs the read you would have done anyway." }
      }
    ]
  },
  one.("Inverted Index", "concept",
       "A map from every term to the documents containing it, which is how search is fast.",
       "Analysis decides what a term even is -- lowercasing, stemming, stop words, n-grams -- and two documents that a user considers identical are different documents to an index configured differently. Which is why changing the analyzer means reindexing everything."),
  one.("Relational Model", "concept",
       "Normalised tables, foreign keys, and a planner that decides how to answer you.",
       "The reason it is still the default: constraints are enforced by the store rather than by every writer, and a query you did not anticipate is a new SELECT rather than a migration. You give up nothing until write volume genuinely exceeds one machine."),
  one.("Document Model", "concept",
       "Whole aggregates stored as one nested value, read and written in one go.",
       "Perfect when the read is always \"give me this entire thing\" and the shape varies per record. The bill arrives when a second access pattern appears and the aggregate you chose is the wrong unit -- joins across documents are the application's problem now."),
  one.("Key-Value Model", "concept",
       "A single lookup by key, and nothing else, at whatever speed the medium allows.",
       "The narrowest interface in the list and therefore the easiest to scale: no planner, no joins, trivially partitionable. Everything you want that is not keyed -- secondary lookups, ranges, aggregates -- has to be modelled as another key you maintain by hand."),
  one.("Wide-Column Model", "concept",
       "Rows grouped into partitions and stored sorted, so one partition read is one seek.",
       "You design the table per query: the partition key decides what is local and the clustering columns decide the order it comes back in. Extremely fast for the questions you planned and effectively unanswerable for the ones you did not."),
  one.("Graph Model", "concept",
       "Nodes and edges as first-class citizens, traversed instead of joined.",
       "The win is variable-depth questions -- shortest path, everything within three hops -- which in SQL are recursive CTEs that degrade badly. This documentation space is itself a graph, which is why it stores relationships as rows rather than a parent pointer."),
  one.("Columnar Model", "concept",
       "Storing each column together, so an aggregate reads only what it needs.",
       "Summing one column over a billion rows touches one column's worth of disk, and values of the same type next to each other compress ten to one. The same layout makes updating a single row an expensive rewrite, which is why this is the analytics side of the house."),
  one.("Immutable Objects and Versioning", "concept",
       "No in-place edit: a new version, and a delete marker that is itself a version.",
       "Immutability is what makes the durability and caching story work, and versioning is what makes deletes recoverable -- at the cost of paying for every version you forgot you kept. A lifecycle rule is not an optimisation here, it is the billing plan."),

  # -- under Caching
  one.("In-Process Cache", "concept",
       "A hash in the application's own memory: the fastest cache and the least consistent.",
       "Nanoseconds per lookup, no network, no serialisation -- and N replicas hold N independently stale copies with no way to invalidate them together. Fine for configuration and reference data with a short TTL; wrong for anything a user can watch change."),
  one.("Shared Cache Tier", "concept",
       "One cache every instance talks to, so there is one copy to invalidate.",
       "Sub-millisecond instead of nanoseconds, in exchange for coherence and for surviving a deploy. It is also a new hard dependency on the request path, which is why the interesting question is what the application does when the cache is simply gone."),
  one.("Reverse Proxy Cache", "concept",
       "Caching whole HTTP responses at the front door, before the application is involved.",
       "The cheapest tier by far when responses are cacheable at all: no application process is woken, so a hit costs microseconds of proxy CPU. Everything hinges on the cache key -- get `Vary` or a query parameter wrong and you serve one user's page to another."),
  one.("Cache Aside", "workflow",
       "Read the cache, fall back to the store, put the answer back.",
       "The default for good reason: the cache holds only what has been asked for, and a cache outage degrades latency rather than correctness. Its weakness is the cold start, where every miss goes straight through to a database sized for a high hit rate."),
  one.("Write-Through and Write-Behind", "workflow",
       "Update the cache as part of the write, synchronously or a moment later.",
       "Write-through keeps the copy fresh and makes every write pay for the cache. Write-behind makes writes fast and introduces a window in which acknowledged data exists only in a cache -- which is a durability decision disguised as a performance one."),
  one.("Early Recompute", "concept",
       "Refreshing a hot value before it expires, so nobody ever waits for the miss.",
       "Either a background job that re-warms known-hot keys, or a probabilistic check that recomputes when a value is close enough to expiry. Both trade a little wasted work for the disappearance of the latency spike at the moment of expiry."),
  one.("LRU and LFU", "concept",
       "Evict by last use, or by how often used -- two different bets on the future.",
       "LRU is one linked list and a hash, and it is wrong exactly when a batch job scans cold data and flushes everything popular. LFU keeps the durably popular and is slow to let go of yesterday's hit."),
  one.("W-TinyLFU", "concept",
       "Admission control for a cache: decide whether a new item deserves to displace an old one.",
       "A tiny frequency sketch answers \"has this key been popular recently?\" in a few bits, and a scanned key that fails the test never enters the main cache at all. This is why modern in-process caches beat plain LRU by ten or more percentage points of hit rate at the same size."),

  # -- under Messaging & Streams
  one.("Visibility Timeout", "concept",
       "A message a consumer is working on is hidden rather than deleted.",
       "If the consumer acknowledges, it disappears; if the consumer dies, the timeout expires and somebody else gets it. The timeout has to exceed the slowest legitimate run of the job, or a slow success and a failure are indistinguishable and the work is done twice."),
  one.("Database-Backed Queue", "queue",
       "Jobs as rows, claimed with a locking select, in the database you already operate.",
       "One fewer system to run, transactional enqueue for free, and a backlog you can query with SQL. It caps out well below a dedicated broker and puts queue churn on your primary's write path -- which for most applications arrives much later than people expect."),
  one.("Dead Letter Queue", "queue",
       "Somewhere for the message that has failed too many times to go.",
       "Without one, a poison message is retried forever and blocks or starves everything behind it; with one, it is parked with its error and its attempt count for a human. The queue that nobody watches is a silent data-loss mechanism, so alert on its depth being non-zero."),
  one.("Partitioned Log", "concept",
       "An append-only log split into partitions, each with its own strict order.",
       "This is the shape that makes a log both ordered and parallel: order is promised within a partition and nowhere else, so the partition key is how you choose what must stay sequential. Consumers track an offset, which is why a reader can rewind and replay."),
  one.("Consumer Groups", "concept",
       "Partitions distributed across a set of consumers, one owner each.",
       "Parallelism is therefore capped by partition count, and a rebalance -- someone joining, leaving or being declared dead -- briefly stops consumption for everyone in the group. Long-running message handlers are the usual cause of a group that rebalances in a loop."),
  one.("Acknowledgement and Redelivery", "concept",
       "The broker keeps a message until somebody says they finished with it.",
       "Acknowledge before processing and a crash loses work; acknowledge after and a crash duplicates it. Everyone picks the second, which is precisely why at-least-once is the default guarantee of every broker worth using."),
  one.("Deduplication Window", "concept",
       "Remembering which ids were already handled, for as long as a duplicate could arrive.",
       "The window is a memory-for-correctness trade: too short and a delayed redelivery slips through as a second effect, too long and you are storing every id you have ever seen. Size it from the broker's maximum redelivery age, not from a round number."),
  one.("Projections", "concept",
       "Read models built by folding the event log into whatever shape a screen needs.",
       "Several projections from one log is the point -- a list view, a search index and a monthly report are three folds of the same events. Each one is disposable, which is what makes a bug in a read model a rebuild rather than a migration."),
  one.("Snapshotting", "concept",
       "Storing a fold of the first N events so replay does not start from the beginning.",
       "Without it, rebuilding an aggregate with 200,000 events means replaying 200,000 events. A snapshot every thousand caps the work -- and must be versioned with the code that produced it, or a stale snapshot silently resurrects old logic."),
  one.("Windowing and Watermarks", "concept",
       "Bounding an unbounded stream by time, and deciding when a window is done.",
       "The watermark is the system's claim that no event older than T will arrive. Set it aggressively and late events are dropped or need a correction; set it conservatively and every result is delayed by the allowance you chose."),
  one.("Checkpointing", "concept",
       "Periodically persisting a stream job's state and offsets together.",
       "The pair is what matters: state without offsets replays into double counting, offsets without state resumes from an empty aggregate. Checkpoint atomically and a restart is invisible apart from the seconds it costs."),
  one.("Log Tailing", "concept",
       "Reading the database's replication stream as if you were another replica.",
       "No triggers, no polling, no extra write path -- just the log the store already writes, decoded into row-level changes. The operational catch is the retained position: a connector that is down long enough for the log to be recycled cannot resume without a fresh snapshot."),
  {
    title: "Transactional Outbox",
    summary: "Write the event to a table in the same transaction as the data, publish it after.",
    metadata: { "note" => "The answer to \"how do I update a row and publish an event atomically?\"" },
    blocks: [
      {
        block_type: "code",
        data: {
          "title" => "One transaction, two facts",
          "language" => "ruby",
          "code" => <<~RUBY
            # There is no atomic step across a database and a broker, so do not try:
            # commit the event alongside the row, and let a separate process publish
            # it. Crash anywhere and the pair is still consistent.
            ApplicationRecord.transaction do
              order.update!(status: "paid")
              Outbox.create!(topic: "orders.paid", payload: { id: order.id })
            end
          RUBY
        }
      },
      {
        block_type: "text",
        data: { "text" => "Relaying is at-least-once by construction -- the publish may succeed and the row's mark-as-sent may not -- so consumers still have to be idempotent. What you have bought is that the event and the data can never disagree." }
      }
    ]
  },

  # -- under Consistency & Coordination
  one.("PACELC", "business_rule",
       "The clause CAP leaves out: even with no partition, latency trades against consistency.",
       "If there is a Partition, choose Availability or Consistency; Else, choose Latency or Consistency. The second half describes normal operation, which is where systems spend all their time, and it is the half that explains why a linearizable store feels slow when nothing is wrong."),
  one.("Linearizability", "concept",
       "Every operation appears to happen instantly, at some point between call and return.",
       "The strongest and most expensive single-object guarantee: it is what lets you treat a distributed register like a variable. Achieving it means a quorum round trip per operation, so it belongs on leader election and counters, not on everything."),
  one.("Causal Consistency", "concept",
       "If one write could have influenced another, everyone sees them in that order.",
       "Much cheaper than total order and enough for most user-visible correctness -- a reply is never seen before the message it answers. Unrelated writes may be seen in different orders by different readers, which is usually invisible and occasionally the bug."),
  one.("Eventual Consistency", "concept",
       "Copies converge once writes stop, and nothing is promised before then.",
       "The honest questions are how long \"eventually\" is under load, and what happens to two conflicting writes: last-write-wins silently discards one, so anything valuable needs either a single owner per key or a merge function that cannot lose data."),
  {
    title: "Raft",
    summary: "Leader election plus an append-only log: consensus a person can hold in their head.",
    blocks: [
      {
        block_type: "text",
        data: { "text" => "One leader per term, chosen by majority vote; entries commit once a majority has them. Five nodes survive two failures, three survive one, and an even number buys nothing -- a four-node group tolerates the same single failure as three while being slower." }
      }
    ]
  },
  one.("Paxos and ZAB", "concept",
       "The older consensus family, and the broadcast protocol ZooKeeper built instead.",
       "Multi-Paxos and Raft make the same guarantees; Raft won the industry on explainability rather than on theory. ZAB is the variant that adds a total order over all state changes, which is what a coordination service needs to offer watches nobody has to reconcile."),
  one.("Multi-Version Concurrency Control", "concept",
       "Readers never block writers, because each transaction sees its own snapshot.",
       "An update writes a new row version and leaves the old one for transactions that still need it, which is why reads take no locks and why dead rows have to be collected later. Vacuum is not maintenance bolted on -- it is the second half of how updates work."),
  one.("Two-Phase Locking", "concept",
       "Acquire every lock you need, do the work, release them all at the end.",
       "The textbook route to serializability, and the reason \"just use serializable\" is not free advice: locks held to commit time convert contention into waiting, and the deadlock detector becomes part of your latency profile."),
  one.("Serializable Snapshot Isolation", "concept",
       "Run optimistically on a snapshot, abort anyone whose assumptions were invalidated.",
       "No read locks, so throughput looks like snapshot isolation until conflicts appear -- at which point some transactions are aborted and must be retried by the application. Serializability paid for in retries rather than in waiting."),
  one.("Two-Phase Commit", "workflow",
       "Everyone promises, then everyone commits -- while holding locks throughout.",
       "Correct, and fragile in a specific way: a participant that has voted yes may not decide alone, so if the coordinator dies between phases the locks stay held until it returns. Atomicity bought with availability."),
  {
    title: "Saga",
    summary: "Local commits in sequence, each with a compensating action for the undo.",
    blocks: [
      {
        block_type: "markdown",
        data: {
          "markdown" => <<~MD
            No locks and no coordinator, in exchange for giving up atomicity: other
            readers can observe the middle of the sequence.

            | Step | Forward | Compensation |
            | --- | --- | --- |
            | 1 | Reserve stock | Release stock |
            | 2 | Charge card | Refund charge |
            | 3 | Create shipment | Cancel shipment |

            Note that compensation is not rollback. A refund is a new fact, and the
            customer saw the charge.
          MD
        }
      }
    ]
  },
  one.("Idempotency Keys", "concept",
       "A caller-supplied id, stored with the result, so a replay returns the first answer.",
       "Store the key, the response and a fingerprint of the request: a repeat with the same key returns the stored response, and a repeat with the same key but a different body is a client bug worth rejecting loudly rather than guessing about."),
  one.("Fencing Tokens", "concept",
       "A monotonically increasing number with the lease, which the resource itself checks.",
       "This is what makes a lease safe against a holder that paused for thirty seconds and woke up believing it still owned the lock: its token is now stale, the storage layer rejects its write, and the split brain never reaches the data."),
  one.("Logical Clocks", "concept",
       "Counters that order events by causality instead of by time.",
       "A Lamport clock gives a total order that never contradicts causality; a vector clock can also tell you that two writes were genuinely concurrent, which is the information last-write-wins throws away. Neither needs the machines' clocks to agree about anything."),
  one.("Hybrid Logical Clocks", "concept",
       "Physical time for readability, a logical counter for correctness.",
       "Timestamps that look like wall clock time, are close to it, and never go backwards even when the clock does. This is the practical compromise in modern distributed databases: human-legible ordering without trusting NTP for correctness."),

  # -- under Networking & APIs
  one.("REST", "api",
       "Resources, verbs and status codes over HTTP, cacheable by anything in the path.",
       "Its real advantage is not purity, it is that every proxy, browser and CDN already understands GET with an ETag. Its real weakness is the chatty client: three screens need three shapes of the same resource, and you either over-fetch or grow endpoints per screen."),
  one.("gRPC", "api",
       "Binary RPC over HTTP/2 with a compiled schema and generated clients.",
       "You get small payloads, streaming in both directions, deadlines in the protocol itself, and a compiler that refuses incompatible changes. You give up curl-ability, easy browser access without a proxy, and caching by anything between the two ends."),
  {
    title: "GraphQL",
    summary: "One endpoint, a typed schema, and a client that asks for exactly the fields it wants.",
    blocks: [
      {
        block_type: "text",
        data: { "text" => "It moves response shaping from the server to the client, which removes a whole class of endpoint sprawl and introduces two problems the server now owns: N+1 loading, answered with batched loaders, and unbounded query cost, answered with depth and complexity limits. This application's own API is GraphQL for exactly that first reason -- the canvas, the inspector and the search panel need different slices of the same graph." }
      }
    ]
  },
  one.("Webhooks", "api",
       "Somebody else's system calling yours when something happens.",
       "An inbound endpoint you do not control the traffic shape of: it retries, it duplicates, it arrives out of order, and it must be verified by signature. Treat every webhook as an at-least-once message from an untrusted network and the whole category becomes boring."),
  one.("HTTP/2 Multiplexing", "concept",
       "Many concurrent streams on one connection, with one remaining flaw.",
       "It removes application-level head-of-line blocking and the six-connections-per-host workaround, but a lost TCP packet still stalls every stream on that connection -- which is the specific problem QUIC and HTTP/3 exist to solve by moving to UDP."),
  one.("TLS Termination", "concept",
       "Where the encrypted connection ends, and what is unencrypted after it.",
       "Terminating at the edge keeps certificates and CPU in one place and leaves the internal hop in plaintext unless something re-encrypts it. That \"unless\" is the entire argument for a service mesh, and the reason it is a compliance question rather than a preference."),
  one.("DNS-Based Discovery", "concept",
       "Resolving a service name to whatever addresses are currently healthy.",
       "It works everywhere and it lies confidently: a client library that resolves once at boot, or a stub resolver with its own TTL, keeps sending traffic to an address that was decommissioned an hour ago. Short TTLs help; connection-level re-resolution helps more."),
  one.("Sidecar Proxy", "concept",
       "A proxy in every pod, so policy is applied next to the process rather than inside it.",
       "All traffic in and out passes through it, which is how retries, mTLS, timeouts and per-call metrics arrive without touching application code in six languages. The cost is a hop, some milliseconds, memory per pod, and a second thing in the path of every incident."),
  one.("mTLS Between Services", "concept",
       "Both ends present certificates, so identity is cryptographic rather than network-based.",
       "It replaces \"anything inside the VPC is trusted\" with an identity per workload, which is what makes authorisation between services meaningful. The hard part was never the handshake -- it is issuing and rotating short-lived certificates without an outage."),
  one.("WebSockets", "concept",
       "A long-lived, bidirectional connection upgraded from an HTTP request.",
       "The right tool when the client also speaks often -- cursors, presence, collaborative editing. It makes your servers stateful: connections must be balanced, drained on deploy, and fanned out across instances through a shared bus, which is exactly what this application does for its canvas."),
  one.("Server-Sent Events", "concept",
       "A one-way stream of events over an ordinary HTTP response, with built-in resume.",
       "Far less machinery than WebSockets when the server does all the talking: it is text over HTTP/1.1 or 2, proxies mostly cope, and the browser reconnects with `Last-Event-ID` on its own. One connection per tab is still one connection per tab."),
  one.("Schema Registry", "concept",
       "A service that stores message schemas and refuses incompatible new versions.",
       "It turns \"someone will break a consumer eventually\" into a failed CI step. Producers register, consumers fetch by id, and the compatibility mode you pick -- backward, forward or full -- is a statement about who you are allowed to deploy first."),
  {
    title: "Compatibility Rules",
    summary: "The three rules that let a schema change without coordinating a deploy.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Change", "Safe?", "Why" ],
          "rows" => [
            [ "Add an optional field", "Yes", "Old readers ignore it" ],
            [ "Add a required field", "No", "Old writers produce invalid messages" ],
            [ "Remove a field", "Only after no reader uses it", "Readers get a default they did not expect" ],
            [ "Reuse a field number or name", "Never", "Old and new meaning coexist on the wire" ],
            [ "Widen an enum", "Yes, if readers tolerate unknown", "Otherwise it is a required change in disguise" ]
          ]
        }
      }
    ]
  },

  # -- under Reliability & Operations
  one.("Half-Open Probe", "concept",
       "Letting exactly one request through to find out whether a dependency recovered.",
       "The alternative -- opening the gates after a timer -- sends the full load at a service that has just come back and knocks it down again. One probe, then a few, then normal: the recovery is as gradual as the failure was sudden."),
  {
    title: "Exponential Backoff with Jitter",
    summary: "Wait longer each attempt, and randomise, so clients stop retrying in lockstep.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "ruby",
          "code" => <<~RUBY
            # Full jitter. Without the random factor every client that failed at the
            # same instant retries at the same instant, and the recovering service is
            # knocked over by the herd it just created.
            def delay(attempt, base: 0.1, cap: 20.0)
              rand * [ cap, base * (2**attempt) ].min
            end
          RUBY
        }
      }
    ]
  },
  one.("Retry Budget", "concept",
       "Capping retries as a fraction of live traffic rather than per request.",
       "Per-request limits still allow a system-wide tripling when everything fails at once. A budget -- say retries may not exceed 10% of requests in the last ten seconds -- makes the total bounded, which is the only property that actually protects the dependency."),
  one.("Hedged Requests", "concept",
       "Send a second copy of a slow request elsewhere and take whichever answers first.",
       "Aimed squarely at the tail: issue the hedge only after the p95, and you spend about 5% more requests to cut p99 latency dramatically. Requires idempotence, and a cancellation path, or you have simply doubled the work."),
  one.("Deadline Propagation", "concept",
       "One budget set at the edge, carried down every hop and shrinking as it goes.",
       "Per-hop timeouts multiply: three hops with a five-second timeout each is a fifteen-second worst case nobody designed. A deadline in the request context means a downstream service can decline work it cannot finish in time, instead of doing it for nobody."),
  one.("Bulkheads", "concept",
       "Separate pools per dependency, so one saturated dependency cannot take all the threads.",
       "Named after ship compartments, and the metaphor is exact: the flooding is contained to one section. In practice it is a connection pool or a semaphore per downstream, sized so that the sum of the worst cases is still less than the process can hold."),
  one.("Priority Queues", "concept",
       "Separating work by how much it matters before the system is short of capacity.",
       "Interactive requests and batch backfills in one queue means the user waits behind a report. Two queues, with the batch one shed first, is how a system degrades in a way a product owner would have chosen."),
  one.("Metrics and Histograms", "concept",
       "Counters and bucketed distributions, cheap enough to keep for every request.",
       "A histogram is the only one of these that survives aggregation: you can add buckets across instances and still get a p99, which you cannot do with pre-computed averages or per-instance percentiles. Cardinality is the cost -- one label with user ids is how a metrics bill becomes an incident."),
  one.("Distributed Tracing", "concept",
       "One id threaded through every hop, so a request's time can be attributed.",
       "It answers the question metrics cannot -- which of the eleven services in this path spent the two seconds -- provided the context is propagated by every one of them. Sampling keeps it affordable and is why the rare pathological request is usually the one that was not recorded."),
  one.("Structured Logs", "concept",
       "Events as key-value records rather than sentences, queryable after the fact.",
       "The moment a log line is JSON with a request id, a duration and an outcome, it stops being prose and starts being data you can group by. This application emits its domain events that way on purpose, so an audit trail and a dashboard read the same rows."),
  one.("Error Budget", "concept",
       "The failure an objective permits, treated as a resource that may be spent.",
       "99.9% over 28 days is 40 minutes. Spending it deliberately on risky releases is how a team ships; discovering at day 20 that it is gone is how a team stops shipping. Either way the argument is now about a number instead of about temperament."),
  one.("Burn Rate Alerts", "concept",
       "Paging on how fast the budget is being consumed, not on a raw error rate.",
       "A 14x burn over five minutes and a 6x burn over an hour catch a sudden outage and a slow bleed with almost no false positives. It is the single highest-leverage change most alerting setups can make, because it replaces a dozen thresholds nobody tuned."),
  one.("Little's Law", "business_rule",
       "Concurrency equals arrival rate times latency, and it is never wrong.",
       "L = λW. It tells you the thread count a target throughput needs, and it explains why latency creeping from 50 ms to 500 ms means ten times the in-flight work for the same traffic -- which is how a system saturates without the request rate changing at all."),
  one.("Load Testing", "workflow",
       "Pushing a copy of production until something bends, before traffic does it for you.",
       "The number you want is not \"it handled it\": it is where the latency curve turns upwards, what resource ran out first, and what the failure looked like. A test that never breaks the system was a rehearsal, not an experiment."),

  # -- under Platform & Deployment
  one.("Image Layers", "concept",
       "A stack of filesystem diffs, shared and cached by content hash.",
       "Order the Dockerfile from least to most frequently changed -- dependencies before application code -- and a rebuild ships a few hundred kilobytes instead of a gigabyte. Every layer is also permanent: a secret added in one layer and deleted in the next is still in the image."),
  one.("Resource Requests and Limits", "concept",
       "What a container is guaranteed, and what it may not exceed.",
       "The request drives scheduling; the limit drives throttling and killing. Set them equal for predictability, set the request too high and you pay for idle capacity, set the memory limit too low and the process is killed mid-request with no stack trace to explain it."),
  one.("Declarative Reconciliation", "concept",
       "A controller comparing desired state to actual, forever.",
       "Everything good and everything confusing about orchestration follows from this loop running without you: a pod you deleted comes back, a manual change is reverted, and the way to make something stop is to change the declaration rather than the world."),
  one.("Rolling Update", "workflow",
       "Replacing instances a few at a time, with health checks as the gate.",
       "Both versions serve traffic simultaneously, which makes it a schema and API compatibility exercise rather than a deployment one. Surge and unavailability settings decide whether you need spare capacity or accept reduced capacity during the roll."),
  one.("Scaling on a Signal", "concept",
       "Choosing the number that the instance count should follow.",
       "CPU is the default and lags the user's experience badly. In-flight requests or queue depth track the backlog directly and react sooner, and both need a cooldown so the controller does not oscillate -- adding capacity, seeing the signal drop, removing it again."),
  one.("Blue-Green", "workflow",
       "Two complete environments, one live, traffic switched at once.",
       "Rollback is a switch back rather than a redeploy, which is worth a great deal at 3am. It costs double capacity during the change and it does not solve the database: one schema is shared by both colours, whatever the traffic is doing."),
  one.("Canary Release", "workflow",
       "A small slice of real traffic on the new version, with a decision rule.",
       "Only worth doing if the metrics are sliced by version and somebody wrote down in advance what would make them stop. Without those two, a canary is a normal deploy with extra steps and a false sense of care."),
  one.("Expand and Contract Migration", "workflow",
       "Add the new schema, write both, backfill, switch reads, then remove the old.",
       "The only pattern that lets a schema change ship without downtime, because at no point does one version of the code require a shape the other cannot produce. It takes several deploys, and the contract step is the one teams forget for a year."),
  one.("Declarative State and Drift", "concept",
       "The file says what should exist; drift is everything someone changed by hand.",
       "Detecting drift is the whole value -- a plan that shows an unexpected change is somebody's undocumented fix, and applying it blindly is how that fix is lost. Treat a console change as an incident note, not as a shortcut."),
  one.("Active-Passive Failover", "workflow",
       "A second region kept warm, promoted when the first is gone.",
       "Simple and survivable: one writer, so no conflict resolution, and the recovery time is however long promotion plus DNS takes. The risk is entirely in the drill -- a failover path exercised twice a year is a failover path that does not work."),
  one.("Active-Active with Local Writes", "workflow",
       "Both regions accept writes, and the conflict question can no longer be avoided.",
       "You must answer it per table: partition ownership by user home region, a merge function that cannot lose data, or a consensus store paying a cross-region round trip per write. \"Last write wins\" across regions with skewed clocks is the option that looks free and is not.")
].freeze
# ------------------------------------------------------------ rung 4: the implementations
#
# Real technologies, each filed under the mechanism it implements rather than under a
# vendor list. The point of this rung is that "we use Kafka" is an answer to "how do you
# get an ordered, replayable, partitioned log", and the graph should make that legible.
IMPLEMENTATION_NODES = [
  # -- proxies, balancers and the edge
  one.("NGINX", "service",
       "The default reverse proxy: layer 7 routing, TLS termination and a response cache in one process.",
       "Event-driven and cheap enough that tens of thousands of idle connections cost almost nothing. Its caching layer is the most underused feature -- `proxy_cache` with `proxy_cache_lock` on is a working answer to a thundering herd before any application code runs."),
  one.("HAProxy", "service",
       "A load balancer with the best health checking and observability of the classic three.",
       "Layer 4 and layer 7, queueing with `maxconn` so a backend is protected rather than buried, and a stats socket that will tell you precisely which server is draining. Chosen when balancing is the job, rather than balancing plus serving files."),
  one.("Envoy", "service",
       "A programmable proxy configured over an API instead of a file, which is why meshes are built on it.",
       "Dynamic discovery of clusters and routes means no reload to change a backend, and outlier detection ejects a failing host without anyone editing anything. It is the same binary at the edge and as a sidecar, which is most of its appeal."),
  one.("Cloudflare", "external_system",
       "An anycast edge network that is a cache, a WAF and a DDoS absorber at once.",
       "Hundreds of points of presence sharing one address, so the TLS handshake happens a few milliseconds from the user and your origin sees a fraction of the requests. The operational catch is that it is now also your DNS, your certificates and, on a bad day, your outage."),
  one.("Fastly", "external_system",
       "An edge network whose selling point is invalidation you can rely on.",
       "Purge by surrogate key, globally, in about 150 milliseconds -- which changes what is cacheable: personalised and frequently-changing pages become edge candidates because you can evict them the moment they change, rather than waiting out a TTL."),
  one.("Varnish", "service",
       "An HTTP cache with a configuration language, which makes the cache key programmable.",
       "VCL lets you normalise the key, strip the cookies that were preventing a hit, and serve stale content deliberately while the origin is down. Entirely in memory, entirely HTTP, and completely useless for anything that is not an HTTP response."),
  one.("PgBouncer", "service",
       "A connection pooler that lets hundreds of clients share tens of PostgreSQL backends.",
       "In transaction mode a server connection is returned after every `COMMIT`, so 500 application threads can live behind 20 backends. Prepared statements, session variables and advisory locks stop behaving, which is the price and should be read before the deploy, not after."),

  # -- databases and engines
  one.("PostgreSQL", "database",
       "The default relational store: MVCC, a serious planner, and extensions for everything else.",
       "Serializable isolation that actually works, partial and expression indexes, JSONB when a column should be a document, logical replication as a change stream, and full-text search good enough to postpone a search cluster for years. This application runs on it."),
  one.("MySQL", "database",
       "The other default, and the one whose replication most of the industry learned on.",
       "InnoDB gives clustered primary keys -- rows live inside the index, so lookups by primary key are one structure -- and the binlog gave the world row-level change streams. Weaker on complex planning, extremely well understood at scale."),
  one.("CockroachDB", "database",
       "A relational store that shards and replicates itself with Raft under a SQL surface.",
       "Every range is a Raft group, so surviving a zone loss needs no failover procedure, and transactions are serializable across shards. You pay for it in cross-range latency, which is why the schema advice is to keep a transaction inside one locality."),
  one.("Google Spanner", "database",
       "Globally distributed SQL with external consistency, bought with synchronised clocks.",
       "TrueTime -- atomic clocks and GPS in every datacentre -- bounds clock uncertainty so tightly that a commit can simply wait it out and get a globally correct order. It is the clearest example in the field of hardware being used to buy a software guarantee."),
  one.("InnoDB", "module",
       "MySQL's storage engine: a clustered B-tree per table with its own buffer pool and redo log.",
       "Because the primary key *is* the table's order, a random UUID key scatters inserts across the whole index and fragments it, while a monotonically increasing key keeps them at the hot end. Secondary indexes store the primary key, so a wide one is paid for in every index."),
  one.("RocksDB", "module",
       "An embeddable LSM key-value store, used inside far more systems than people realise.",
       "Kafka Streams, Flink's state backend, CockroachDB's early storage layer and countless services keep local state here because it gives write-optimised, on-disk, ordered storage in a library. Its tuning surface is enormous and its compaction is where the I/O goes."),
  one.("Apache Cassandra", "database",
       "A masterless wide-column store: consistent hashing, LSM storage, tunable per-query consistency.",
       "No leader means no failover and linear write scaling; the same property means no cross-partition transactions and no ad-hoc queries. You choose the consistency level per statement, which is unusually honest -- the trade is in the query rather than in the cluster."),
  one.("MongoDB", "database",
       "The document store that made schemaless mainstream, then added the guarantees back.",
       "Multi-document transactions, causal consistency and a read-your-writes session concept now exist, which addresses the original complaints. The design question is unchanged: the aggregate you chose as a document is the unit you can atomically update."),
  one.("Amazon DynamoDB", "database",
       "A key-value store priced per operation, where the partition key is the performance model.",
       "There is no query planner to blame -- throughput is the partition's, so a skewed key is a hot partition regardless of how much capacity the table has. Single-digit millisecond reads at any scale, provided every access pattern was designed before the data existed."),
  one.("Neo4j", "database",
       "A graph database where a traversal follows pointers rather than joining tables.",
       "Relationships are stored with the nodes, so \"everything within four hops\" costs the hops instead of four joins over growing tables. Cypher makes those queries readable, and the limit is the usual one: aggregate questions over the whole graph are not what it is for."),
  one.("ClickHouse", "database",
       "A columnar store that answers aggregate queries over billions of rows in under a second.",
       "Sorted, compressed columns and vectorised execution, so a sum over one column of a 10-billion-row table reads a few gigabytes instead of terabytes. Updates are a rewrite, joins are awkward, and both are acceptable in exchange for the scan speed."),
  one.("Elasticsearch", "external_system",
       "Lucene's inverted index as a distributed service, for search and for log analytics.",
       "Relevance scoring, aggregations and fuzzy matching out of the box; a cluster whose health depends on shard count, heap size and how long you keep indices. Most teams arrive here for search and stay for the dashboards."),
  one.("PostgreSQL Full-Text Search", "module",
       "`tsvector`, GIN indexes and ranking inside the database you already run.",
       "Good enough for hundreds of thousands of documents with no second system to operate, no sync to get wrong, and joins against your own tables. This application's search is exactly this, which is why a documentation space can filter by role in the same query it searches by word."),
  one.("Amazon S3", "external_system",
       "Object storage as a utility, and the de facto interface for it.",
       "Eleven nines of durability, strong read-after-write since 2020, lifecycle rules that move data to colder tiers on a schedule, and an API that a dozen other products now imitate. Requests cost money, which is why millions of tiny objects is an architecture smell."),
  one.("MinIO", "external_system",
       "An S3-compatible object store you run yourself, including on a laptop.",
       "The value is the identical API: the same client code and the same presigned URLs work against a local container and against a cloud bucket, so development and production differ in configuration rather than in code paths."),

  # -- caches
  one.("Redis", "database",
       "An in-memory data structure server: the usual shared cache, and a passable queue and lock.",
       "Lists, sorted sets, streams and Lua scripting mean it is often the answer to a problem that is not caching at all -- rate limiters, leaderboards, presence. Single-threaded command execution is why one O(n) command on a large key stalls every other client."),
  one.("Memcached", "external_system",
       "A cache that deliberately does one thing: a distributed hash table with LRU.",
       "No persistence, no replication, no data structures, and multi-threaded -- which is exactly why it is still chosen for pure caching at very high request rates. When \"I just need a fast shared hash and I do not care if it is lost\" is true, this is the smaller answer."),
  one.("Caffeine", "module",
       "An in-process cache whose admission policy is W-TinyLFU rather than plain LRU.",
       "Near-optimal hit rates at a given size, asynchronous refresh, and per-entry expiry -- the reference implementation of the idea that a cache should decide what deserves to *enter* it, not only what to evict."),

  # -- brokers, queues and streams
  one.("Apache Kafka", "queue",
       "A partitioned, replicated, durable log; the reference implementation of most of this area.",
       "Retention is by time or size rather than by consumption, so readers can rewind and a new consumer can replay history. Ordering is per partition only, delivery is at least once, and parallelism is capped by partition count -- three facts that decide most designs built on it."),
  one.("Redpanda", "queue",
       "Kafka's API without the JVM or ZooKeeper, written to use modern disks directly.",
       "A thread-per-core C++ implementation with Raft for replication, aimed at lower tail latency and simpler operations. The interesting part for a design document is that the API compatibility makes it a deployment decision rather than an architectural one."),
  one.("Amazon Kinesis", "queue",
       "A managed partitioned stream, billed and scaled by shard.",
       "The same mental model as Kafka with the operations removed and the limits made explicit: a shard is 1 MB/s in and 2 MB/s out, and capacity planning becomes arithmetic on shard counts rather than on brokers."),
  one.("Amazon SQS", "queue",
       "A managed queue whose entire interface is a visibility timeout and a dead letter queue.",
       "Nearly unlimited throughput for standard queues, at-least-once delivery and no ordering; FIFO queues add ordering and deduplication with a much lower rate. The simplest correct queue available, provided your consumers are idempotent."),
  one.("Google Cloud Pub/Sub", "queue",
       "Global topics with per-subscription ack deadlines and automatic flow control.",
       "Publishers and subscribers scale independently with no partitions to size, which removes the most common Kafka planning mistake and takes away replay-by-offset in exchange. Ack deadline extension is the knob that matters for slow handlers."),
  one.("RabbitMQ", "queue",
       "A broker whose exchanges and bindings make routing a configuration concern.",
       "Direct, topic and fanout exchanges cover most routing needs without application code, and per-consumer prefetch is how you stop one greedy worker from hoarding a backlog. Queues are meant to stay short -- it is a router, not a log."),
  one.("Solid Queue", "module",
       "A database-backed job backend for Rails, using the primary store rather than a broker.",
       "Jobs are rows claimed with `FOR UPDATE SKIP LOCKED`, so enqueueing is transactional with the data that caused it and the whole backlog is inspectable with SQL. This application's own background work runs on it, which is why there is no broker in its compose file."),
  one.("Sidekiq", "module",
       "The Ruby job runner that made Redis-backed queues the default in that ecosystem.",
       "Threads rather than processes for a much lower memory footprint per job, with retries, scheduling and a dashboard as standard. The enqueue is not transactional with your database, which is exactly the gap the transactional outbox pattern fills."),
  one.("Apache Flink", "external_system",
       "A stateful stream processor with real event-time semantics and checkpointed state.",
       "Watermarks, windows, and exactly-once end-to-end when the sink cooperates -- plus terabytes of managed state, which is what separates it from a library that merely reads a topic. The operational weight is a genuine cluster with a genuine state backend."),
  one.("Kafka Streams", "module",
       "Stream processing as a library inside your own service, with state in RocksDB.",
       "No cluster to run: scaling is running more copies of your application, and the partition assignment does the rest. Ideal when the job belongs to one team and one topic; limiting when the pipeline grows more stages than a deploy can coordinate."),
  one.("Debezium", "external_system",
       "Change data capture connectors that turn a database's log into a topic per table.",
       "It reads PostgreSQL's logical replication slots or MySQL's binlog, emits before and after images, and handles the initial snapshot before switching to streaming. The classic use is keeping a cache, a search index and a warehouse in step without the application knowing they exist."),

  # -- coordination
  one.("etcd", "external_system",
       "A small, strongly consistent key-value store built on Raft, with leases and watches.",
       "Linearizable reads, a revision number per change, and watches from a revision -- which together are enough to build leader election, service registries and distributed locks. It is also Kubernetes' entire memory, which is why its disk latency is a cluster-wide concern."),
  one.("Apache ZooKeeper", "external_system",
       "The original coordination service: ZAB, ephemeral nodes and watches.",
       "Ephemeral znodes that vanish when a session ends make membership and leader election natural, which is why a generation of Hadoop, Kafka and HBase clusters depended on it. Still correct, gradually being replaced by Raft implementations embedded in the systems themselves."),
  one.("HashiCorp Consul", "external_system",
       "A service registry with health checking, a key-value store and a DNS interface.",
       "Services register, agents health-check them locally, and the result is queryable over DNS or HTTP -- so discovery works for applications that know nothing about it. Raft underneath, which is what makes the registry trustworthy during a partition."),
  one.("CoreDNS", "service",
       "The pluggable DNS server that answers service names inside a Kubernetes cluster.",
       "Every in-cluster hostname resolves through it, which makes it both invisible and load-bearing: its cache TTLs and its NDOTS search-path behaviour explain a surprising share of \"intermittent connection refused\" reports."),
  one.("Conflict-Free Replicated Data Types", "concept",
       "Data types whose merge is commutative, associative and idempotent -- so order stops mattering.",
       "Two replicas that received the same edits in different orders reach the same state with no coordination and no lost data. This is the strongest thing you can have while staying available during a partition, and it is what makes offline-capable collaborative editing possible at all."),

  # -- contracts and transports
  one.("Protocol Buffers", "module",
       "A schema language and binary encoding where field numbers are the contract.",
       "Numbers, not names, are on the wire, so renaming a field is free and reusing a number is corruption. Generated code in every language, a fraction of JSON's bytes, and a hard dependency on somebody owning the `.proto` files."),
  one.("Apache Avro", "module",
       "A binary format whose schema travels with the data or lives in a registry.",
       "Built for long-lived logs and analytics: a reader's schema and a writer's schema are resolved together, so a five-year-old file is still readable by today's code. The reason it dominates the data-warehouse side of streaming rather than the RPC side."),
  one.("GraphQL Ruby", "module",
       "The Ruby implementation of GraphQL, including the batching and limits a server needs.",
       "Types as classes, dataloaders to collapse N+1 queries into one, and complexity and depth analysis to stop a single query from being a denial of service. This application's API is built on it, which is why the canvas can ask for a level of the graph in one round trip."),
  one.("Istio", "external_system",
       "The heavyweight service mesh: Envoy sidecars plus a control plane with a policy API.",
       "mTLS everywhere, traffic shifting by percentage, retries and timeouts as configuration, and per-call telemetry with no application changes. It is also a substantial system in its own right, and the reason \"do we need a mesh yet\" is a real question."),
  one.("Linkerd", "external_system",
       "A mesh that chose smallness: a purpose-built Rust proxy and very few knobs.",
       "Latency-aware load balancing, automatic mTLS and golden metrics out of the box, with a fraction of the resource footprint and configuration surface. The trade is deliberate -- fewer features, far less to understand."),
  one.("Action Cable", "module",
       "Rails' WebSocket layer: channels, subscriptions and a pub/sub backend for fan-out.",
       "Each server holds its clients' sockets and broadcasts travel between servers over the adapter -- Redis, or in this application's case PostgreSQL's `LISTEN`/`NOTIFY` via the solid adapter. Presence and live cursors on the canvas are this plus a heartbeat."),

  # -- observability and platform
  one.("Prometheus", "external_system",
       "Pull-based metrics with a dimensional data model and a query language over time.",
       "It scrapes targets it discovered, stores samples locally, and evaluates alert rules with the same language you graph with. Cardinality is the whole operational story: one label with unbounded values will end the instance, not slow it down."),
  one.("Grafana", "external_system",
       "The dashboard layer over whatever is storing the metrics, logs and traces.",
       "Its real contribution is a shared visual vocabulary -- the same four panels for every service means a stranger can read your dashboard during an incident. Alerting lives here too, which is a decision worth making deliberately rather than by drift."),
  one.("OpenTelemetry", "module",
       "One vendor-neutral standard for traces, metrics and logs, with SDKs and a collector.",
       "Instrument once, export anywhere, and change backends without touching application code -- which is the first time that has been true. The collector is the piece to understand: it batches, samples and routes, so it is where cost control actually happens."),
  one.("Jaeger", "external_system",
       "A trace store and UI: find the slow request, see where the time went.",
       "Service dependency graphs derived from real traffic and per-span timing, which turns \"checkout is slow\" into \"the tax service is slow, in the p99 only\". Sampling strategy decides whether the trace you want is the one you kept."),
  one.("Grafana Loki", "external_system",
       "Logs indexed by label rather than by content, so keeping them is affordable.",
       "It refuses to build a full-text index and instead stores compressed chunks addressed by the same labels as your metrics, then greps them on query. Cheap ingestion and storage; slower ad-hoc search, which is the right trade for logs nobody reads until an incident."),
  one.("k6", "module",
       "Load tests written as JavaScript, with thresholds that make a run pass or fail.",
       "Because the thresholds are in the script -- p95 under 300 ms, error rate under 1% -- a load test becomes a CI gate rather than a document. Ramping stages are what let you find the knee of the curve instead of a single number."),
  one.("Docker", "external_system",
       "The image format and the local workflow that made containers ordinary.",
       "Layer caching turns a rebuild into a diff, and one `compose up` gives a new contributor the whole stack -- this repository included. In production the runtime is usually containerd underneath something else; the image is the part that persisted."),
  one.("Kubernetes", "external_system",
       "A reconciliation engine for containers that became the industry's control plane API.",
       "Deployments, services, config, autoscalers and rollouts all expressed declaratively and kept true by controllers. The complexity is real and so is the payoff: the same YAML describes the desired state on a laptop cluster and across three availability zones."),
  one.("Argo Rollouts", "module",
       "Canary and blue-green as a Kubernetes resource, with metric analysis as the gate.",
       "It shifts a percentage of traffic, queries Prometheus against a threshold you wrote down, and promotes or rolls back without a human deciding under pressure. Progressive delivery stops being a process document and becomes a controller."),
  one.("KEDA", "module",
       "Autoscaling on external signals -- queue depth, stream lag, a query result.",
       "It turns \"scale the workers on the backlog, not on CPU\" into a few lines of configuration, including scaling to zero when the queue is empty. The right answer for consumers, where CPU is the least informative signal available."),
  one.("Terraform", "module",
       "Infrastructure declared in HCL, with a plan you read before anything changes.",
       "The plan is the product: a reviewable diff of what will happen to production. The state file is the thing to respect -- it is the map between your declarations and real resources, and it is the one file a team can genuinely lose.")
].freeze
# ----------------------------------------------------------------- rung 5: the internals
#
# One rung below a technology: the specific machinery inside it that you end up reading
# about during an incident.
INTERNAL_NODES = [
  # -- Apache Kafka
  one.("In-Sync Replicas and acks", "concept",
       "Kafka's durability dial: how many replicas must have a record before it is acknowledged.",
       "`acks=all` means all *in-sync* replicas, and the in-sync set shrinks when a follower falls behind -- so without `min.insync.replicas` your strongest setting can silently degrade to one copy. The pair is the setting; either one alone is a false sense of safety."),
  one.("Log Segments and Retention", "concept",
       "The partition on disk is a series of segment files, deleted or compacted whole.",
       "Retention is evaluated per segment, so data lives a little longer than the policy says, and compaction keeps only the newest record per key -- which is how a topic becomes a table. A consumer slower than retention loses data quietly and reports it as an offset out of range."),
  one.("Consumer Group Rebalance", "concept",
       "Partition ownership being reshuffled, which stops consumption while it happens.",
       "A member that misses its poll interval is declared dead and its partitions are reassigned, so a handler that occasionally takes two minutes causes a group that rebalances forever. Cooperative rebalancing narrows the stop-the-world window; it does not remove the cause."),

  # -- PostgreSQL
  one.("Autovacuum", "concept",
       "The background process that reclaims dead row versions MVCC leaves behind.",
       "Fall behind and you get table bloat, index bloat and eventually a forced anti-wraparound vacuum that cannot be postponed. On a large hot table the default thresholds -- a fraction of the table -- are far too lazy, and per-table settings are the usual fix."),
  one.("WAL and Replication Slots", "concept",
       "The write-ahead log doubles as the replication stream, and a slot marks a reader's place.",
       "A slot guarantees the log is kept until the consumer catches up, which is exactly what makes change data capture reliable and exactly how a forgotten slot fills the primary's disk. Monitor slot lag with the same seriousness as disk space, because they are the same alert."),
  one.("Query Planner and Statistics", "concept",
       "Costs estimated from sampled statistics decide every join order and index choice.",
       "When a query suddenly takes a thousand times longer, the plan changed, and the plan changed because the statistics did. `EXPLAIN (ANALYZE, BUFFERS)` comparing estimated to actual rows is how you find the bad estimate rather than guessing at indexes."),
  one.("Backend Process per Connection", "concept",
       "Each PostgreSQL connection is an operating system process, not a thread.",
       "Megabytes of memory and real context-switching cost per connection, which is why the effective ceiling is in the hundreds rather than the thousands, and why a pooler is not an optimisation but part of the architecture."),

  # -- Redis
  {
    title: "Single-Threaded Event Loop",
    summary: "One thread executes every command, so every command is atomic and every slow one is fatal.",
    blocks: [
      {
        block_type: "text",
        data: { "text" => "Atomicity for free -- no locks, no interleaving, which is what makes Lua scripts and `INCR` safe primitives for rate limiters. The other side is that one `KEYS *` or one `SMEMBERS` over a million-element set blocks every other client for as long as it takes, and the incident looks like a network problem." }
      }
    ]
  },
  one.("RDB and AOF Persistence", "concept",
       "A point-in-time fork-and-dump, or an append-only log of commands.",
       "RDB is compact and loses everything since the last snapshot; AOF with `everysec` loses about a second and rewrites itself periodically. Both fork, so a 20 GB instance briefly needs memory for copied pages -- the classic cause of an out-of-memory kill during a save."),
  one.("Memory Limit and Eviction", "concept",
       "Redis needs a memory ceiling and a policy, or the operating system chooses for you.",
       "With no `maxmemory` set, a growing dataset ends as an out-of-memory kill rather than as an eviction. Set the ceiling to about 70% of the box when persistence is on, because a background save forks and the copied pages need somewhere to live."),
  one.("Cluster Hash Slots", "concept",
       "16,384 fixed slots mapped to nodes, with keys assigned by CRC16 of the key.",
       "Resharding moves slots rather than rehashing keys, and a multi-key command only works if the keys share a slot -- which is what hash tags in braces are for. Clients must follow `MOVED` and `ASK` redirects, so a cluster-unaware library fails in confusing ways."),

  # -- Apache Cassandra
  one.("Memtables and SSTables", "concept",
       "Writes land in memory and a commit log, then flush to immutable sorted files.",
       "A read may touch several SSTables, which is why bloom filters and a partition index sit in front of them. Compaction merges those files and is the loudest thing on the disk: choosing its strategy is choosing which workload you are optimising for."),
  one.("Tunable Consistency", "concept",
       "The consistency level is an argument to the statement, not a property of the cluster.",
       "`LOCAL_QUORUM` for both reads and writes gives you R + W > N inside a datacentre without paying a cross-region round trip; `ONE` for writes and `ALL` for reads is the same arithmetic with the cost moved. The same table can be strong for one query and eventual for the next."),
  one.("Hinted Handoff", "concept",
       "A write meant for a node that is down is held by a coordinator and delivered later.",
       "It papers over short outages so a brief restart does not require a repair, and it stops helping precisely when it matters: hints expire, and a node down longer than that window needs an actual repair to become consistent again."),

  # -- Elasticsearch
  one.("Lucene Segments and Merges", "concept",
       "Each refresh writes a small immutable segment; merges combine them in the background.",
       "This is why a document is searchable a second after indexing rather than immediately, and why a heavy indexing run competes with queries for I/O. A deleted document is only a tombstone until a merge rewrites the segment without it."),
  one.("Shards, Replicas and Routing", "concept",
       "A shard is a Lucene index, and the primary shard count cannot be changed after creation.",
       "A query fans out to every shard and merges the results, so too many small shards is overhead per search and too few is a ceiling on parallelism and growth. Routing by a field keeps related documents on one shard and turns a fan-out into a single-shard search."),

  # -- Kubernetes
  one.("Scheduler and Bin Packing", "concept",
       "Pods are placed by fitting requests into remaining capacity, with affinity as a constraint.",
       "Only *requests* are considered, so a cluster that looks 60% allocated can be 95% used if limits are far above requests. Anti-affinity across zones is what stops three replicas of the same service from being one zone outage."),
  one.("Control Plane and etcd", "concept",
       "Every object lives in etcd, and the API server is the only thing that talks to it.",
       "Controllers watch for changes and act, which is why a slow etcd disk shows up as deployments that will not progress rather than as a database error. It also means cluster state has a backup story, and that story is an etcd snapshot."),
  one.("Liveness and Readiness Probes", "concept",
       "One probe restarts the container; the other decides whether it receives traffic.",
       "Confusing them is the classic self-inflicted outage: a liveness probe that hits a dependency restarts healthy pods when that dependency is slow. Readiness should reflect \"can I serve\", liveness only \"am I wedged\"."),

  # -- etcd
  one.("Leases and Watches", "concept",
       "A key with a time-to-live that a client must keep renewing, and change notifications from a revision.",
       "Together they are the primitive under most leader election: hold a lease, renew it, and everyone watching from a known revision learns the instant it lapses. Because a watch resumes from a revision, a reconnecting client misses nothing."),

  # -- Amazon S3
  one.("Read-After-Write Consistency", "concept",
       "Since 2020, a successful PUT is immediately readable, including a fresh overwrite.",
       "The eventual-consistency workarounds an older generation of pipelines was built around -- retry loops, manifest files, waiting a few seconds -- are now unnecessary. Listing is strongly consistent too, which removed the most subtle class of data-pipeline bug."),
  one.("Storage Classes and Lifecycle", "concept",
       "Where an object lives is a price per gigabyte and a retrieval delay.",
       "Standard, infrequent access, and archival tiers differ by an order of magnitude in cost and by minutes-to-hours in retrieval. A lifecycle rule that transitions after 30 days and expires after a year is the difference between storage as a line item and storage as a surprise."),

  # -- Envoy
  one.("Outlier Detection", "concept",
       "A proxy ejecting a host that is failing, without anybody configuring a health endpoint.",
       "Consecutive 5xx responses or a latency far above the cluster's median takes a host out of rotation for a growing interval, then lets it back in. Passive rather than active: the real traffic is the health check, and the ejection is capped so a bad deploy cannot eject everything."),

  # -- CRDTs
  one.("Yjs", "module",
       "A CRDT implementation for text and structured data, with awareness for presence.",
       "Character-level merging with no server-side conflict resolution, plus binary update messages small enough to send on every keystroke. This application's collaborative blocks are Yjs documents relayed over Action Cable, which is why two people can type in one paragraph."),

  # -- Prometheus
  one.("Pull Scraping and Staleness", "concept",
       "Prometheus fetches from targets on an interval, and a missing scrape is explicit.",
       "Pulling means the monitoring system knows a target vanished rather than assuming quiet means healthy, and it makes a target's `/metrics` endpoint independently inspectable. Short-lived jobs do not fit this model at all, which is what the push gateway exists to patch."),
  one.("Recording and Alerting Rules", "concept",
       "Expressions evaluated on a schedule: one stores a result, the other fires.",
       "A recording rule pre-computes an expensive query so dashboards and alerts read a cheap series instead; an alerting rule is the same expression plus a `for` duration that suppresses flapping. Both live in version control, which is what makes an alerting policy reviewable.")
].freeze

# ------------------------------------------------------------------- rung 6: the numbers
#
# The bottom of the ladder, where advice becomes a value you type. Everything here is a
# setting, a limit or a figure -- deliberately the rung with the fewest words per card.
NUMBER_NODES = [
  {
    title: "acks, ISR and unclean leader election",
    summary: "The three Kafka settings that decide whether an acknowledged write can be lost.",
    blocks: [
      {
        block_type: "code",
        data: {
          "title" => "Durable producer and topic configuration",
          "language" => "properties",
          "code" => <<~PROPS
            # Producer
            acks=all
            enable.idempotence=true
            max.in.flight.requests.per.connection=5   # safe with idempotence on
            retries=2147483647
            delivery.timeout.ms=120000

            # Topic / broker
            replication.factor=3
            min.insync.replicas=2                     # acks=all now means "2 of 3"
            unclean.leader.election.enable=false       # never promote a stale replica
          PROPS
        }
      },
      {
        block_type: "text",
        data: { "text" => "With replication factor 3 and min.insync.replicas 2 the cluster tolerates one broker down and still refuses to acknowledge a write it cannot keep. Set min.insync.replicas equal to the replication factor and a single restart stops all writes." }
      }
    ]
  },
  {
    title: "Retention and compaction settings",
    summary: "How long a Kafka topic keeps data, and when it keeps only the latest per key.",
    blocks: [
      {
        block_type: "json",
        data: {
          "title" => "Two topics, two intentions",
          "value" => {
            "events.orders" => {
              "cleanup.policy" => "delete",
              "retention.ms" => 604_800_000,
              "segment.bytes" => 1_073_741_824,
              "note" => "Seven days of history: enough to replay a bad consumer deploy."
            },
            "state.customer_profile" => {
              "cleanup.policy" => "compact",
              "min.cleanable.dirty.ratio" => 0.1,
              "note" => "A table, not a stream: the newest record per key is kept forever."
            }
          }
        }
      }
    ]
  },
  {
    title: "Rebalance and poll timeouts",
    summary: "The four values that decide whether a slow handler looks like a dead consumer.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Setting", "Typical", "Means" ],
          "rows" => [
            [ "session.timeout.ms", "45000", "No heartbeat for this long and the member is dead" ],
            [ "heartbeat.interval.ms", "3000", "Roughly a third of the session timeout" ],
            [ "max.poll.interval.ms", "300000", "Processing may take this long between polls" ],
            [ "max.poll.records", "500", "Lower this instead of raising the interval" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The usual mistake is raising max.poll.interval.ms to accommodate a slow batch. Fetching fewer records per poll keeps failure detection fast and fixes the same problem." }
      }
    ]
  },
  {
    title: "synchronous_commit and WAL retention",
    summary: "PostgreSQL's durability dial, and the settings that keep a replica able to catch up.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "sql",
          "code" => <<~SQL
            -- Per transaction, not just per cluster: the reporting job can be fast and
            -- the payment can be durable, in the same database.
            SET LOCAL synchronous_commit = 'off';     -- ~1 commit of data at risk
            SET LOCAL synchronous_commit = 'local';   -- fsync here, do not wait for replicas
            SET LOCAL synchronous_commit = 'on';      -- wait for synchronous_standby_names

            -- Keep enough log for a replica or a CDC connector to resume.
            ALTER SYSTEM SET wal_keep_size = '4GB';
            ALTER SYSTEM SET max_slot_wal_keep_size = '32GB';  -- a slot cannot fill the disk
          SQL
        }
      },
      {
        block_type: "text",
        data: { "text" => "max_slot_wal_keep_size is the setting that turns \"a forgotten replication slot took the primary down\" into \"a forgotten replication slot broke one consumer\"." }
      }
    ]
  },
  {
    title: "Autovacuum thresholds worth changing",
    summary: "The defaults are sized for small tables; a hot large table needs its own numbers.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "sql",
          "code" => <<~SQL
            -- Default: vacuum after 20% of the table is dead. On 200 million rows that
            -- is 40 million dead tuples of bloat before anything happens.
            ALTER TABLE nodes SET (
              autovacuum_vacuum_scale_factor = 0.02,   -- 2%
              autovacuum_vacuum_cost_limit = 2000,     -- let it actually keep up
              autovacuum_analyze_scale_factor = 0.01   -- statistics for the planner
            );
          SQL
        }
      }
    ]
  },
  {
    title: "Reading EXPLAIN ANALYZE",
    summary: "Estimated rows against actual rows is the number that explains a bad plan.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "sql",
          "code" => <<~SQL
            EXPLAIN (ANALYZE, BUFFERS)
            SELECT * FROM nodes WHERE documentation_space_id = 1 AND layer_id = 4;

            -- Seq Scan on nodes  (cost=0.00..4821.00 rows=12 width=284)
            --                    (actual time=0.031..38.402 rows=9184 loops=1)
            --   Buffers: shared hit=1204 read=2617
            --
            -- Estimated 12, got 9184: the statistics are stale or the two columns are
            -- correlated. Fix the estimate -- ANALYZE, or CREATE STATISTICS on the pair --
            -- before adding an index to compensate for it.
          SQL
        }
      }
    ]
  },
  {
    title: "Latency numbers to compare against",
    summary: "The orders of magnitude that decide whether a cache is worth having.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Operation", "Time", "Relative" ],
          "rows" => [
            [ "L1 cache reference", "1 ns", "1x" ],
            [ "Main memory reference", "100 ns", "100x" ],
            [ "Redis GET on the same network", "200 µs", "200,000x" ],
            [ "NVMe random read", "100 µs", "100,000x" ],
            [ "Indexed read from PostgreSQL", "1 ms", "1,000,000x" ],
            [ "Round trip within a datacentre", "500 µs", "500,000x" ],
            [ "Round trip London to Sydney", "250 ms", "250,000,000x" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "The gap that matters most is the last one: no amount of backend optimisation competes with not crossing an ocean, which is the entire argument for edge delivery." }
      }
    ]
  },
  {
    title: "maxmemory-policy",
    summary: "What Redis does when it is full, which is a decision about what the data is.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Policy", "Behaviour", "Use when" ],
          "rows" => [
            [ "noeviction", "Writes start failing", "The data is not reconstructible" ],
            [ "allkeys-lru", "Drop the least recently used", "Pure cache" ],
            [ "allkeys-lfu", "Drop the least frequently used", "Cache with a stable hot set" ],
            [ "volatile-ttl", "Drop soonest-to-expire first", "Mixed cache and state" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Running a queue and a cache in one Redis with allkeys-lru means the cache can evict the queue. Two instances, or two policies, is the fix." }
      }
    ]
  },
  {
    title: "Compaction strategy by workload",
    summary: "Cassandra's three strategies, and which amplification each one accepts.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Strategy", "Good for", "Pays in" ],
          "rows" => [
            [ "Size-tiered", "Write-heavy, immutable rows", "Read amplification, 50% space headroom" ],
            [ "Leveled", "Read-heavy, updated rows", "Write amplification, constant I/O" ],
            [ "Time-window", "Time series with a TTL", "Nothing, if queries are by time" ]
          ]
        }
      }
    ]
  },
  {
    title: "Shard sizing rules of thumb",
    summary: "The figures that keep an Elasticsearch cluster out of trouble.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Rule", "Value", "Why" ],
          "rows" => [
            [ "Shard size", "10-50 GB", "Recovery and merges stay bounded" ],
            [ "Shards per GB of heap", "< 20", "Each shard costs heap to keep open" ],
            [ "Heap per node", "≤ 31 GB", "Above this, compressed object pointers are lost" ],
            [ "Primary shard count", "Fixed at creation", "Changing it means reindexing" ]
          ]
        }
      }
    ]
  },
  {
    title: "Requests and limits for a web pod",
    summary: "A starting point, and the two mistakes it avoids.",
    blocks: [
      {
        block_type: "code",
        data: {
          "language" => "yaml",
          "code" => <<~YAML
            resources:
              requests:
                cpu: "500m"        # what the scheduler reserves
                memory: "512Mi"    # set equal to the limit: memory is not compressible
              limits:
                cpu: "2"           # burst for a slow request, throttled not killed
                memory: "512Mi"    # exceed this and the container is OOMKilled

            # Two mistakes this avoids:
            #   requests far below limits -> a "60% allocated" cluster that is 95% used
            #   memory request below limit -> eviction under node pressure, mid-request
          YAML
        }
      }
    ]
  },
  {
    title: "Object lifecycle and cost per tier",
    summary: "Roughly what each S3 storage class costs, and what it costs to get data back.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Class", "Per GB-month", "Retrieval" ],
          "rows" => [
            [ "Standard", "~$0.023", "Immediate" ],
            [ "Infrequent access", "~$0.0125", "Immediate, per-GB fee" ],
            [ "Glacier instant", "~$0.004", "Immediate, higher fee" ],
            [ "Glacier deep archive", "~$0.00099", "Hours" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "Figures move and vary by region, so treat the ratios rather than the numbers as the fact: archival is roughly 20x cheaper to store and meaningfully expensive to read, which is exactly the shape of a backup." }
      }
    ]
  },
  {
    title: "Burn rate alert thresholds",
    summary: "Two windows and two multiples, which is the whole alerting policy.",
    blocks: [
      {
        block_type: "table",
        data: {
          "columns" => [ "Window", "Burn rate", "Budget spent", "Action" ],
          "rows" => [
            [ "5 minutes", "14.4x", "2%", "Page someone" ],
            [ "1 hour", "6x", "5%", "Page someone" ],
            [ "6 hours", "3x", "10%", "Open a ticket" ],
            [ "3 days", "1x", "100% at this pace", "Review at the next planning" ]
          ]
        }
      },
      {
        block_type: "text",
        data: { "text" => "A fast burn catches an outage in minutes; a slow burn catches the regression that would otherwise consume the month unnoticed. Together they replace a dozen static thresholds nobody tuned." }
      }
    ]
  }
].freeze

SEED_NODES = [
  *FIELD_NODES,
  *AREA_NODES,
  *CONCEPT_NODES,
  *MECHANISM_NODES,
  *IMPLEMENTATION_NODES,
  *INTERNAL_NODES,
  *NUMBER_NODES
].freeze

# The reading hierarchy: what you drill into, written parent by parent.
#
# Deliberately not a tree. Consistent hashing is part of both load balancing and sharding,
# a write-ahead log is part of both storage engines and replication, and Envoy is an
# implementation of both a layer 7 balancer and a mesh sidecar. A node's rung comes from
# its *shortest* path to the root, so a shared child sits at the depth of its shallowest
# parent.
SEED_HIERARCHY = {
  "System Design" => [
    "Scaling & Load", "Data Storage", "Caching", "Messaging & Streams",
    "Consistency & Coordination", "Networking & APIs", "Reliability & Operations",
    "Platform & Deployment", "Failure Modes"
  ],

  "Scaling & Load" => [ "Horizontal Scaling", "Load Balancing", "Rate Limiting", "Edge Delivery", "Connection Pooling" ],
  "Data Storage" => [ "Replication", "Sharding", "Indexing", "Storage Engines", "Data Models", "Object Storage" ],
  "Caching" => [ "Cache Placement", "Cache Invalidation", "Eviction Policies" ],
  "Messaging & Streams" => [ "Message Queues", "Publish and Subscribe", "Delivery Guarantees", "Event Sourcing", "Stream Processing", "Change Data Capture" ],
  "Consistency & Coordination" => [ "CAP Theorem", "Consistency Models", "Consensus", "Isolation Levels", "Distributed Transactions", "Idempotency", "Leases and Locks", "Clocks and Ordering" ],
  "Networking & APIs" => [ "API Styles", "HTTP and TLS", "Service Discovery", "Service Mesh", "Real-time Transport", "Serialization" ],
  "Reliability & Operations" => [ "Circuit Breaker", "Retries and Backoff", "Timeouts and Deadlines", "Load Shedding", "Observability", "Service Level Objectives", "Capacity Planning" ],
  "Platform & Deployment" => [ "Containers", "Orchestration", "Autoscaling", "Deployment Strategies", "Infrastructure as Code", "Multi-Region" ],
  "Failure Modes" => [
    "Hot Shard", "Thundering Herd", "Cascading Failure", "Split Brain", "Retry Storm",
    "Head-of-Line Blocking", "Clock Skew", "Data Loss on Failover", "Backlog Explosion"
  ],

  # ---- concepts to mechanisms
  "Horizontal Scaling" => [ "Stateless Services", "Sticky Sessions" ],
  "Load Balancing" => [ "Layer 4 and Layer 7", "Consistent Hashing", "Health Checking" ],
  "Rate Limiting" => [ "Token Bucket", "Sliding Window Counter" ],
  "Edge Delivery" => [ "Anycast and Points of Presence", "HTTP Cache Headers" ],
  "Connection Pooling" => [ "Transaction Pooling" ],

  "Replication" => [ "Leader and Followers", "Write-Ahead Log", "Quorum Reads and Writes", "Read Replicas and Lag" ],
  "Sharding" => [ "Range and Hash Partitioning", "Consistent Hashing", "Resharding and Backfill" ],
  "Indexing" => [ "B-Tree", "Inverted Index", "Bloom Filter" ],
  "Storage Engines" => [ "LSM Tree", "B-Tree", "Write-Ahead Log" ],
  "Data Models" => [ "Relational Model", "Document Model", "Key-Value Model", "Wide-Column Model", "Graph Model", "Columnar Model" ],
  "Object Storage" => [ "Immutable Objects and Versioning" ],

  "Cache Placement" => [ "In-Process Cache", "Shared Cache Tier", "Reverse Proxy Cache" ],
  "Cache Invalidation" => [ "Cache Aside", "Write-Through and Write-Behind", "HTTP Cache Headers", "Early Recompute" ],
  "Eviction Policies" => [ "LRU and LFU", "W-TinyLFU" ],

  "Message Queues" => [ "Visibility Timeout", "Database-Backed Queue", "Dead Letter Queue" ],
  "Publish and Subscribe" => [ "Partitioned Log", "Consumer Groups" ],
  "Delivery Guarantees" => [ "Acknowledgement and Redelivery", "Deduplication Window" ],
  "Event Sourcing" => [ "Projections", "Snapshotting" ],
  "Stream Processing" => [ "Windowing and Watermarks", "Checkpointing" ],
  "Change Data Capture" => [ "Log Tailing", "Transactional Outbox" ],

  "CAP Theorem" => [ "PACELC" ],
  "Consistency Models" => [ "Linearizability", "Causal Consistency", "Eventual Consistency" ],
  "Consensus" => [ "Raft", "Paxos and ZAB", "Quorum Reads and Writes" ],
  "Isolation Levels" => [ "Multi-Version Concurrency Control", "Two-Phase Locking", "Serializable Snapshot Isolation" ],
  "Distributed Transactions" => [ "Two-Phase Commit", "Saga", "Transactional Outbox" ],
  "Idempotency" => [ "Idempotency Keys", "Deduplication Window" ],
  "Leases and Locks" => [ "Fencing Tokens" ],
  "Clocks and Ordering" => [ "Logical Clocks", "Hybrid Logical Clocks" ],

  "API Styles" => [ "REST", "gRPC", "GraphQL", "Webhooks" ],
  "HTTP and TLS" => [ "HTTP/2 Multiplexing", "TLS Termination", "HTTP Cache Headers" ],
  "Service Discovery" => [ "DNS-Based Discovery" ],
  "Service Mesh" => [ "Sidecar Proxy", "mTLS Between Services" ],
  "Real-time Transport" => [ "WebSockets", "Server-Sent Events" ],
  "Serialization" => [ "Schema Registry", "Compatibility Rules" ],

  "Circuit Breaker" => [ "Half-Open Probe" ],
  "Retries and Backoff" => [ "Exponential Backoff with Jitter", "Retry Budget", "Hedged Requests" ],
  "Timeouts and Deadlines" => [ "Deadline Propagation" ],
  "Load Shedding" => [ "Bulkheads", "Priority Queues" ],
  "Observability" => [ "Metrics and Histograms", "Distributed Tracing", "Structured Logs" ],
  "Service Level Objectives" => [ "Error Budget", "Burn Rate Alerts" ],
  "Capacity Planning" => [ "Little's Law", "Load Testing" ],

  "Containers" => [ "Image Layers", "Resource Requests and Limits" ],
  "Orchestration" => [ "Declarative Reconciliation", "Rolling Update" ],
  "Autoscaling" => [ "Scaling on a Signal" ],
  "Deployment Strategies" => [ "Blue-Green", "Canary Release", "Expand and Contract Migration" ],
  "Infrastructure as Code" => [ "Declarative State and Drift" ],
  "Multi-Region" => [ "Active-Passive Failover", "Active-Active with Local Writes" ],

  # ---- mechanisms to the technologies that implement them
  "Layer 4 and Layer 7" => [ "NGINX", "HAProxy", "Envoy" ],
  "Anycast and Points of Presence" => [ "Cloudflare", "Fastly" ],
  "Reverse Proxy Cache" => [ "Varnish", "NGINX" ],
  "Transaction Pooling" => [ "PgBouncer" ],

  "Leader and Followers" => [ "PostgreSQL", "MySQL" ],
  "Range and Hash Partitioning" => [ "Amazon DynamoDB" ],
  "B-Tree" => [ "InnoDB" ],
  "LSM Tree" => [ "RocksDB", "Apache Cassandra" ],
  "Inverted Index" => [ "Elasticsearch", "PostgreSQL Full-Text Search" ],
  "Relational Model" => [ "PostgreSQL", "MySQL", "CockroachDB", "Google Spanner" ],
  "Document Model" => [ "MongoDB" ],
  "Key-Value Model" => [ "Redis", "Amazon DynamoDB" ],
  "Wide-Column Model" => [ "Apache Cassandra" ],
  "Graph Model" => [ "Neo4j" ],
  "Columnar Model" => [ "ClickHouse" ],
  "Immutable Objects and Versioning" => [ "Amazon S3", "MinIO" ],

  "In-Process Cache" => [ "Caffeine" ],
  "Shared Cache Tier" => [ "Redis", "Memcached" ],
  "W-TinyLFU" => [ "Caffeine" ],

  "Visibility Timeout" => [ "Amazon SQS", "Google Cloud Pub/Sub" ],
  "Database-Backed Queue" => [ "Solid Queue" ],
  "Acknowledgement and Redelivery" => [ "RabbitMQ", "Sidekiq" ],
  "Partitioned Log" => [ "Apache Kafka", "Redpanda", "Amazon Kinesis" ],
  "Windowing and Watermarks" => [ "Apache Flink", "Kafka Streams" ],
  "Log Tailing" => [ "Debezium" ],

  "Raft" => [ "etcd", "CockroachDB", "HashiCorp Consul" ],
  "Paxos and ZAB" => [ "Apache ZooKeeper" ],
  "Multi-Version Concurrency Control" => [ "PostgreSQL" ],
  "Eventual Consistency" => [ "Conflict-Free Replicated Data Types" ],

  "gRPC" => [ "Protocol Buffers" ],
  "GraphQL" => [ "GraphQL Ruby" ],
  "Schema Registry" => [ "Apache Avro" ],
  "Sidecar Proxy" => [ "Envoy", "Istio", "Linkerd" ],
  "DNS-Based Discovery" => [ "CoreDNS", "HashiCorp Consul" ],
  "WebSockets" => [ "Action Cable" ],

  "Metrics and Histograms" => [ "Prometheus", "Grafana" ],
  "Distributed Tracing" => [ "OpenTelemetry", "Jaeger" ],
  "Structured Logs" => [ "Grafana Loki" ],
  "Load Testing" => [ "k6" ],

  "Image Layers" => [ "Docker" ],
  "Declarative Reconciliation" => [ "Kubernetes" ],
  "Canary Release" => [ "Argo Rollouts" ],
  "Scaling on a Signal" => [ "KEDA" ],
  "Declarative State and Drift" => [ "Terraform" ],
  "Active-Active with Local Writes" => [ "CockroachDB", "Google Spanner" ],

  # ---- technologies to their internals
  "Apache Kafka" => [ "In-Sync Replicas and acks", "Log Segments and Retention", "Consumer Group Rebalance" ],
  "PostgreSQL" => [ "Autovacuum", "WAL and Replication Slots", "Query Planner and Statistics", "Backend Process per Connection" ],
  "Redis" => [ "Single-Threaded Event Loop", "Memory Limit and Eviction", "RDB and AOF Persistence", "Cluster Hash Slots" ],
  "Apache Cassandra" => [ "Memtables and SSTables", "Tunable Consistency", "Hinted Handoff" ],
  "Elasticsearch" => [ "Lucene Segments and Merges", "Shards, Replicas and Routing" ],
  "Kubernetes" => [ "Scheduler and Bin Packing", "Control Plane and etcd", "Liveness and Readiness Probes" ],
  "etcd" => [ "Leases and Watches" ],
  "Amazon S3" => [ "Read-After-Write Consistency", "Storage Classes and Lifecycle" ],
  "Envoy" => [ "Outlier Detection" ],
  "Conflict-Free Replicated Data Types" => [ "Yjs" ],
  "Prometheus" => [ "Pull Scraping and Staleness", "Recording and Alerting Rules" ],

  # ---- internals to the numbers you type
  "In-Sync Replicas and acks" => [ "acks, ISR and unclean leader election" ],
  "Log Segments and Retention" => [ "Retention and compaction settings" ],
  "Consumer Group Rebalance" => [ "Rebalance and poll timeouts" ],
  "WAL and Replication Slots" => [ "synchronous_commit and WAL retention" ],
  "Autovacuum" => [ "Autovacuum thresholds worth changing" ],
  "Query Planner and Statistics" => [ "Reading EXPLAIN ANALYZE" ],
  "Single-Threaded Event Loop" => [ "Latency numbers to compare against" ],
  "Memory Limit and Eviction" => [ "maxmemory-policy" ],
  "Memtables and SSTables" => [ "Compaction strategy by workload" ],
  "Shards, Replicas and Routing" => [ "Shard sizing rules of thumb" ],
  "Scheduler and Bin Packing" => [ "Requests and limits for a web pod" ],
  "Storage Classes and Lifecycle" => [ "Object lifecycle and cost per tier" ],
  "Recording and Alerting Rules" => [ "Burn rate alert thresholds" ]
}.freeze

# The part that makes this a graph rather than a book.
#
# Read `caused_by` and `mitigates` in both directions and the failure modes become an
# index into the rest of the space: from the symptom you are looking at to the mechanism
# you are missing.
SEED_CROSS_EDGES = [
  # -- what a technique cannot work without
  [ "Horizontal Scaling", "requires", "Load Balancing" ],
  [ "Horizontal Scaling", "requires", "Connection Pooling" ],
  [ "Retries and Backoff", "requires", "Idempotency" ],
  [ "Message Queues", "requires", "Idempotency" ],
  [ "Delivery Guarantees", "requires", "Idempotency" ],
  [ "Service Level Objectives", "requires", "Observability" ],
  [ "Capacity Planning", "requires", "Observability" ],
  [ "Stream Processing", "requires", "Event Sourcing" ],
  [ "Change Data Capture", "requires", "Replication" ],
  [ "Leases and Locks", "requires", "Clocks and Ordering" ],
  [ "Multi-Region", "requires", "Replication" ],
  [ "Autoscaling", "requires", "Containers" ],
  [ "Orchestration", "requires", "Service Discovery" ],
  [ "Deployment Strategies", "requires", "Orchestration" ],
  [ "Load Shedding", "requires", "Timeouts and Deadlines" ],

  # -- what a technique makes possible
  [ "Sharding", "enables", "Horizontal Scaling" ],
  [ "Replication", "enables", "Horizontal Scaling" ],
  [ "Cache Placement", "enables", "Horizontal Scaling" ],
  [ "Event Sourcing", "enables", "Publish and Subscribe" ],
  [ "Consensus", "enables", "Distributed Transactions" ],
  [ "Consensus", "enables", "Leases and Locks" ],
  [ "Change Data Capture", "enables", "Stream Processing" ],
  [ "Containers", "enables", "Orchestration" ],
  [ "Infrastructure as Code", "enables", "Multi-Region" ],
  [ "Service Mesh", "enables", "Observability" ],
  [ "Edge Delivery", "enables", "HTTP and TLS" ],

  # -- the law that limits the choice
  [ "CAP Theorem", "constrains", "Replication" ],
  [ "CAP Theorem", "constrains", "Consensus" ],
  [ "CAP Theorem", "constrains", "Distributed Transactions" ],
  [ "CAP Theorem", "constrains", "Consistency Models" ],
  [ "CAP Theorem", "constrains", "Multi-Region" ],
  [ "CAP Theorem", "constrains", "Caching" ],

  # -- what breaks, and what answers it
  [ "Sharding", "causes", "Hot Shard" ],
  [ "Cache Invalidation", "causes", "Thundering Herd" ],
  [ "Retries and Backoff", "causes", "Retry Storm" ],
  [ "Timeouts and Deadlines", "causes", "Cascading Failure" ],
  [ "Replication", "causes", "Data Loss on Failover" ],
  [ "Consensus", "causes", "Split Brain" ],
  [ "Message Queues", "causes", "Backlog Explosion" ],
  [ "Clocks and Ordering", "causes", "Clock Skew" ],
  [ "HTTP and TLS", "causes", "Head-of-Line Blocking" ],

  [ "Rate Limiting", "mitigates", "Thundering Herd" ],
  [ "Circuit Breaker", "mitigates", "Cascading Failure" ],
  [ "Timeouts and Deadlines", "mitigates", "Cascading Failure" ],
  [ "Load Shedding", "mitigates", "Backlog Explosion" ],
  [ "Load Shedding", "mitigates", "Retry Storm" ],
  [ "Leases and Locks", "mitigates", "Split Brain" ],
  [ "Consensus", "mitigates", "Split Brain" ],
  [ "Cache Placement", "mitigates", "Hot Shard" ],
  [ "Autoscaling", "mitigates", "Backlog Explosion" ],
  [ "Replication", "mitigates", "Hot Shard" ],
  [ "Clocks and Ordering", "mitigates", "Clock Skew" ],

  # -- the honest tensions
  [ "Caching", "trades_off_with", "Consistency & Coordination" ],
  [ "Sharding", "trades_off_with", "Distributed Transactions" ],
  [ "Indexing", "trades_off_with", "Storage Engines" ],
  [ "Consistency Models", "trades_off_with", "Replication" ],
  [ "Service Mesh", "trades_off_with", "Timeouts and Deadlines" ],
  [ "Object Storage", "trades_off_with", "Data Models" ],
  [ "Real-time Transport", "trades_off_with", "Horizontal Scaling" ],
  [ "Multi-Region", "trades_off_with", "Isolation Levels" ],

  # -- mechanism-level dependencies, which is where the graph stops being a tree
  [ "LSM Tree", "requires", "Bloom Filter" ],
  [ "LSM Tree", "trades_off_with", "B-Tree" ],
  [ "W-TinyLFU", "trades_off_with", "LRU and LFU" ],
  [ "Saga", "trades_off_with", "Two-Phase Commit" ],
  [ "Hedged Requests", "requires", "Idempotency" ],
  [ "Transactional Outbox", "requires", "Deduplication Window" ],
  [ "Quorum Reads and Writes", "trades_off_with", "CAP Theorem" ],
  [ "Stateless Services", "enables", "Rolling Update" ],
  [ "Rolling Update", "requires", "Health Checking" ],
  [ "Expand and Contract Migration", "enables", "Blue-Green" ],
  [ "Canary Release", "requires", "Metrics and Histograms" ],
  [ "mTLS Between Services", "requires", "TLS Termination" ],
  [ "Schema Registry", "requires", "Compatibility Rules" ],
  [ "Protocol Buffers", "requires", "Compatibility Rules" ],
  [ "gRPC", "requires", "HTTP/2 Multiplexing" ],
  [ "REST", "references", "HTTP Cache Headers" ],
  [ "Read Replicas and Lag", "trades_off_with", "Consistency Models" ],
  [ "Fencing Tokens", "requires", "Logical Clocks" ],

  # -- what each failure mode is answered by, at mechanism level
  [ "Consistent Hashing", "mitigates", "Hot Shard" ],
  [ "Resharding and Backfill", "mitigates", "Hot Shard" ],
  [ "Sticky Sessions", "causes", "Hot Shard" ],
  [ "HTTP Cache Headers", "mitigates", "Thundering Herd" ],
  [ "Early Recompute", "mitigates", "Thundering Herd" ],
  [ "Exponential Backoff with Jitter", "mitigates", "Retry Storm" ],
  [ "Retry Budget", "mitigates", "Retry Storm" ],
  [ "Half-Open Probe", "mitigates", "Retry Storm" ],
  [ "Bulkheads", "mitigates", "Cascading Failure" ],
  [ "Deadline Propagation", "mitigates", "Cascading Failure" ],
  [ "Priority Queues", "mitigates", "Backlog Explosion" ],
  [ "Dead Letter Queue", "mitigates", "Head-of-Line Blocking" ],
  [ "Partitioned Log", "causes", "Head-of-Line Blocking" ],
  [ "HTTP/2 Multiplexing", "mitigates", "Head-of-Line Blocking" ],
  [ "Fencing Tokens", "mitigates", "Split Brain" ],
  [ "Raft", "mitigates", "Split Brain" ],
  [ "Quorum Reads and Writes", "mitigates", "Data Loss on Failover" ],
  [ "In-Sync Replicas and acks", "mitigates", "Data Loss on Failover" ],
  [ "Logical Clocks", "mitigates", "Clock Skew" ],
  [ "Hybrid Logical Clocks", "mitigates", "Clock Skew" ],
  [ "KEDA", "mitigates", "Backlog Explosion" ],
  [ "Varnish", "mitigates", "Thundering Herd" ],
  [ "PgBouncer", "mitigates", "Backend Process per Connection" ],

  # -- technology on technology, which is most of what an architecture diagram shows
  [ "Kubernetes", "requires", "etcd" ],
  [ "Kubernetes", "requires", "CoreDNS" ],
  [ "Docker", "enables", "Kubernetes" ],
  [ "Istio", "requires", "Envoy" ],
  [ "Istio", "requires", "Kubernetes" ],
  [ "Linkerd", "requires", "Kubernetes" ],
  [ "Argo Rollouts", "reads_from", "Prometheus" ],
  [ "KEDA", "requires", "Kubernetes" ],
  [ "Grafana", "reads_from", "Prometheus" ],
  [ "Grafana", "reads_from", "Grafana Loki" ],
  [ "Jaeger", "reads_from", "OpenTelemetry" ],
  [ "Kafka Streams", "requires", "Apache Kafka" ],
  [ "Kafka Streams", "requires", "RocksDB" ],
  [ "Apache Flink", "requires", "Checkpointing" ],
  [ "Redpanda", "references", "Apache Kafka" ],
  [ "Debezium", "reads_from", "WAL and Replication Slots" ],
  [ "Debezium", "enables", "Projections" ],
  [ "Sidekiq", "requires", "Redis" ],
  [ "Solid Queue", "requires", "PostgreSQL" ],
  [ "Action Cable", "requires", "Publish and Subscribe" ],
  [ "Yjs", "references", "Action Cable" ],
  [ "CockroachDB", "requires", "Hybrid Logical Clocks" ],
  [ "Google Spanner", "requires", "Clocks and Ordering" ],
  [ "InnoDB", "requires", "Write-Ahead Log" ],
  [ "Prometheus", "enables", "Burn Rate Alerts" ],
  [ "Elasticsearch", "trades_off_with", "PostgreSQL Full-Text Search" ],
  [ "Memcached", "trades_off_with", "Redis" ]
].freeze

SEED_RELATIONSHIPS = [
  *SEED_HIERARCHY.flat_map { |parent, children| children.map { |child| [ parent, "contains", child ] } },
  *SEED_CROSS_EDGES
].freeze

# -----------------------------------------------------------------------------------------
# Derived structure: rung and position.
#
# Neither is declared per node, and that is deliberate. A rung declared by hand drifts out
# of step with the hierarchy the moment a node is moved, and 160 hand-written coordinate
# pairs are 160 chances to put two cards on top of each other. Both are computed from the
# containment graph instead, which also means the fixture obeys the same rule the
# application does: a child sits one rung below its parent.
# -----------------------------------------------------------------------------------------

CHILDREN_BY_PARENT = SEED_HIERARCHY
PARENTS_BY_CHILD = SEED_HIERARCHY.each_with_object({}) do |(parent, children), map|
  children.each { |child| (map[child] ||= []) << parent }
end

SEED_ROOT_TITLES = SEED_NODES.map { |node| node[:title] } - PARENTS_BY_CHILD.keys

# Breadth-first, so a node with parents on two different rungs lands on the shallower one.
SEED_DEPTHS = {}.tap do |depths|
  frontier = SEED_ROOT_TITLES.map { |title| [ title, 0 ] }

  until frontier.empty?
    title, depth = frontier.shift
    next if depths.key?(title)

    depths[title] = depth
    CHILDREN_BY_PARENT.fetch(title, []).each { |child| frontier << [ child, depth + 1 ] }
  end
end

# A grid per sibling group, because the canvas draws one level at a time.
#
# Columns 320 apart and rows 170, centred on the origin, so every level opens with its
# cards in view. A node shared by two parents is placed in the first group that claims it
# and then nudged down a row if that lands it on top of a sibling in the second.
SEED_COLUMNS = 4
SEED_COLUMN_WIDTH = 320
SEED_ROW_HEIGHT = 170

SEED_POSITIONS = {}.tap do |positions|
  slot = lambda do |index, count|
    columns = [ count, SEED_COLUMNS ].min
    rows = (count / SEED_COLUMNS.to_f).ceil
    [
      ((index % SEED_COLUMNS) - (columns - 1) / 2.0) * SEED_COLUMN_WIDTH,
      ((index / SEED_COLUMNS) - (rows - 1) / 2.0) * SEED_ROW_HEIGHT
    ]
  end

  SEED_ROOT_TITLES.each_with_index do |title, index|
    positions[title] = slot.(index, SEED_ROOT_TITLES.size)
  end

  SEED_HIERARCHY.each do |_parent, children|
    children.each_with_index do |child, index|
      positions[child] ||= slot.(index, children.size)
    end
  end

  # Collision pass. Two cards on the same point in some level is the one layout bug a
  # reader would notice immediately, so each group is checked and the later card of any
  # colliding pair drops a row until the point is free. Bounded, because a shared node can
  # be pushed into a new collision in the group it came from.
  10.times do
    collided = false

    SEED_HIERARCHY.each_value do |children|
      taken = {}

      children.each do |child|
        point = positions[child]
        while taken.key?(point)
          point = [ point[0], point[1] + SEED_ROW_HEIGHT ]
          collided = true
        end

        taken[point] = true
        positions[child] = point
      end
    end

    break unless collided
  end
end

owner = User.find_by(email: SEED_SPACE_OWNER_EMAIL) || User.first

if owner.nil?
  puts "No users to own a documentation space; skipping."
else
  space = owner.documentation_spaces.find_by(slug: SEED_SPACE_SLUG)

  if space.nil?
    space = Documentation::CreateSpace.call(
      user: owner,
      name: "System Design Knowledge Graph",
      description: "A worked example: the ideas behind distributed systems, the mechanisms under them, the technologies that implement them, and the trades between them.",
      actor: owner
    )
    space.update!(slug: SEED_SPACE_SLUG)
  end

  nodes_by_title = space.nodes.where(title: SEED_NODES.map { |attributes| attributes.fetch(:title) })
                        .order(id: :desc).index_by(&:title)

  SEED_NODES.each do |attributes|
    title = attributes.fetch(:title)
    depth = SEED_DEPTHS.fetch(title)
    x, y = SEED_POSITIONS.fetch(title)

    node = nodes_by_title[title] || space.nodes.build(title: title)
    node.assign_attributes(
      x: x,
      y: y,
      z: [ 2 - depth, 0 ].max,
      summary: attributes[:summary],
      metadata: attributes.fetch(:metadata, {})
    )
    node.save!

    nodes_by_title[title] = node
  end

  # Blocks come after every node exists, because a `node_reference` block points at one by
  # title and cannot be written until that title has an id.
  SEED_NODES.each do |attributes|
    node = nodes_by_title.fetch(attributes.fetch(:title))
    blocks = attributes.fetch(:blocks, [])
    # Only this fixture's positions, one node at a time: loading every page at once
    # would exchange database round trips for a large startup memory spike.
    existing_blocks = node.content_blocks.where(position: 0...blocks.size).index_by(&:position)

    blocks.each_with_index do |block_attributes, position|
      data = block_attributes.fetch(:data)

      if (referenced_title = data["node_title"])
        data = data.except("node_title").merge("nodeId" => nodes_by_title.fetch(referenced_title).id.to_s)
      end

      block = existing_blocks[position] || node.content_blocks.build(position: position)
      block.assign_attributes(block_type: block_attributes.fetch(:block_type), data: data)
      block.save!
    end

    # Removing blocks the fixture no longer defines is what makes this converge rather
    # than accumulate: without it, shortening a node's documentation above would leave
    # the old blocks behind forever.
    node.content_blocks.where("position >= ?", blocks.size).destroy_all
  end

  node_ids = nodes_by_title.values.map(&:id)
  existing_relationships = space.node_relationships.where(source_node_id: node_ids, target_node_id: node_ids)
                                .pluck(:source_node_id, :relationship_type, :target_node_id).to_set

  SEED_RELATIONSHIPS.each do |(source_title, relationship_type, target_title)|
    source = nodes_by_title.fetch(source_title)
    target = nodes_by_title.fetch(target_title)
    next if existing_relationships.include?([ source.id, relationship_type, target.id ])

    NodeRelationship.find_or_create_by!(
      source_node: source,
      target_node: target,
      relationship_type: relationship_type
    ) { |relationship| relationship.documentation_space = space }
  end

  # Nodes the fixture no longer defines are left alone: a space that someone has been
  # editing should not lose their work to a re-seed. Only the titles above are managed.
  by_rung = SEED_DEPTHS.values.tally.sort.map { |rung, count| "#{rung}:#{count}" }.join(" ")

  puts "  #{space.nodes.count} nodes, #{space.node_relationships.count} relationships, " \
       "#{ContentBlock.where(node: space.nodes).count} content blocks"
  puts "  Rungs (depth:nodes) #{by_rung}"
  puts "  Open it at /spaces/#{space.public_id}"
end
