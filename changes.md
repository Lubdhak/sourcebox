# Implement the Correct CRDT Architecture for Plate.js Documentation Editor

We are using **Plate.js / Slate as the rich-text editor**.

I want to implement collaborative editing using **Yjs**, while keeping **Markdown as a serialization/export format rather than the collaborative source of truth**.

Before changing anything, inspect the existing codebase carefully and understand the current Plate editor, document persistence, Markdown handling, API layer, and database schema.

Do not rewrite working editor functionality.

## Core architectural decision

The canonical collaborative document must be:

```text
Y.Doc
  ↓
@platejs/yjs
  ↓
Plate / Slate document model
  ↓
React rendering
```

Markdown must be a projection/serialization:

```text
Plate Document
      ↓
@platejs/markdown
      ↓
Markdown
```

And importing Markdown should work in the opposite direction:

```text
Markdown
    ↓
@platejs/markdown
    ↓
Plate Document
    ↓
Y.Doc
```

Do NOT implement Markdown as the CRDT representation.

Do NOT create a character-level CRDT over Markdown.

Do NOT continuously convert:

```text
Plate → Markdown → CRDT → Markdown → Plate
```

This would introduce unnecessary parsing, serialization, cursor-position, formatting, and conflict problems.

---

# 1. Use Plate's official Yjs integration

Use the current Plate Yjs integration:

```text
@platejs/yjs
```

Use the APIs provided by the installed/current version of Plate rather than inventing a custom Slate ↔ Yjs synchronization layer.

First inspect:

* installed Plate version
* installed `@platejs/yjs` version
* existing editor configuration
* existing plugins
* existing Markdown plugin
* existing persistence layer

Follow the API appropriate to the versions actually installed.

Plate's Yjs integration should own the synchronization between the Plate/Slate document and `Y.Doc`.

Do not manually mutate the shared `Y.Doc` unless the Plate/Yjs API explicitly requires it.

---

# 2. Canonical document model

Treat the Plate document as the editor's structured document model.

Conceptually:

```ts
type PlateDocument = Descendant[]
```

It may contain:

```text
paragraph
heading
blockquote
list
list item
link
image
table
table row
table cell
code block
callout
custom block
JSON block
media block
embed
dropdown
etc.
```

The exact node types must come from the existing application.

Do not replace them with Markdown strings.

Formatting should remain structural.

For example:

```json
{
  "type": "p",
  "children": [
    {
      "text": "Hello world",
      "bold": true
    }
  ]
}
```

rather than:

```text
Hello **world**
```

The user should see rich formatting in the editor.

Markdown syntax should not appear merely because a user applies formatting.

---

# 3. Yjs is the collaborative source of truth

When collaboration is enabled:

```text
User A
   ↓
Plate
   ↓
Yjs
   ↓
shared Y.Doc
   ↓
User B
   ↓
Plate
```

The CRDT should capture the structured editor state and operations needed to merge concurrent changes.

Examples:

```text
insert text
delete text
format text
insert paragraph
delete paragraph
split paragraph
merge paragraph
insert heading
move block
insert table
modify table cell
insert link
modify link
etc.
```

Do not create application-level Markdown diffs such as:

```diff
- Hello **world**
+ Hello **beautiful world**
```

Markdown diffs are not the CRDT.

---

# 4. Markdown is a serialization format

Use the existing Plate Markdown support:

```text
@platejs/markdown
```

Use the appropriate current APIs for:

```text
serialize
deserialize
```

Conceptually:

```text
editor.children
      ↓
markdown.serialize()
      ↓
Markdown
```

and:

```text
Markdown
      ↓
markdown.deserialize()
      ↓
Plate Value
```

Do not make Markdown the canonical persisted collaborative state.

---

# 5. Persistence architecture

Inspect the existing persistence implementation.

If the application currently stores Markdown, preserve that functionality where useful, but separate these concepts:

### Collaborative state

```text
Y.Doc
```

### Editor state

```text
Plate / Slate document
```

### Human-readable/export representation

```text
Markdown
```

### Application metadata

```text
title
owner
permissions
graph relationships
node metadata
version
timestamps
etc.
```

Do not mix these concepts.

If the current database stores Markdown, continue supporting Markdown persistence/export without making Markdown the CRDT protocol.

If Yjs persistence is being introduced, design the persistence layer so a Yjs document can be stored/reloaded efficiently.

Do not store a new Markdown snapshot on every keystroke.

---

# 6. Snapshot strategy

Implement a sensible persistence strategy.

Do NOT:

```text
every keystroke
    ↓
serialize entire Plate document
    ↓
serialize Markdown
    ↓
write database
```

Instead:

```text
User edits
    ↓
Yjs local state
    ↓
Yjs updates
    ↓
collaboration provider / persistence
```

Then periodically or on appropriate lifecycle events, generate a Markdown snapshot if the application needs one.

For example:

```text
Y.Doc
  ↓
Plate document
  ↓
Markdown snapshot
  ↓
database
```

The snapshot should be considered derived data.

Make the architecture explicit so that a stale Markdown snapshot cannot overwrite newer collaborative state.

---

# 7. Initial document loading

Be particularly careful with initialization.

When using Plate + Yjs, do not allow Plate's default initialization and Yjs initialization to race.

Use the appropriate Plate Yjs configuration for skipping normal editor initialization when Yjs owns the initial document state.

The lifecycle should conceptually be:

```text
load document ID
      ↓
create Plate editor
      ↓
initialize Yjs
      ↓
connect provider
      ↓
sync Y.Doc
      ↓
render Plate document
```

For a brand-new document:

```text
initial Plate value
      ↓
Y.Doc initialization
      ↓
shared document
```

For an existing collaborative document:

```text
Y.Doc existing state
      ↓
sync
      ↓
ignore stale initial Plate value
```

Avoid duplicate initialization.

---

# 8. Markdown import

When the user imports Markdown:

```text
Markdown
   ↓
deserialize
   ↓
Plate Value
   ↓
Yjs transaction
```

Do not:

```text
Markdown
   ↓
directly replace database Markdown
```

The imported document must become part of the collaborative document state.

Handle this as a document-level operation/transaction.

---

# 9. Markdown export

When exporting:

```text
Y.Doc
  ↓
Plate document
  ↓
markdown.serialize()
  ↓
Markdown
```

The exported Markdown must represent the current collaborative state.

Never export an independently maintained Markdown document that may be stale.

---

# 10. Custom Plate nodes

This application supports more than basic rich text.

We may have nodes representing:

```text
JSON
tables
images
multimedia
URLs
dropdowns
shapes
embeds
custom documentation blocks
graph references
```

Treat these as structured Plate nodes.

For example:

```json
{
  "type": "json",
  "data": {
    "foo": "bar"
  },
  "children": [
    {
      "text": ""
    }
  ]
}
```

or whatever schema already exists in the application.

Do not flatten these into Markdown unless there is an explicit serialization rule.

For unsupported/custom nodes, preserve the structured node in the canonical document even if Markdown export requires:

* custom MDX
* fenced blocks
* HTML
* placeholders
* metadata
* or another explicitly defined representation.

Do not silently discard information during serialization.

---

# 11. Round-trip guarantees

Add tests for:

```text
Markdown
    ↓
Plate
    ↓
Markdown
```

and:

```text
Plate
    ↓
Markdown
    ↓
Plate
```

For supported content, verify semantic equivalence.

Test:

* headings
* paragraphs
* bold
* italic
* links
* lists
* code
* blockquotes
* tables
* images
* custom nodes
* nested structures
* empty blocks
* multiline content

Do not require byte-for-byte Markdown equality where multiple valid Markdown representations exist.

Test semantic equivalence instead.

---

# 12. Collaboration tests

Add tests for concurrent editing.

At minimum:

### Concurrent text insertion

```text
User A inserts text
User B inserts text
```

Verify both changes survive.

### Concurrent formatting

```text
User A applies bold
User B edits nearby text
```

Verify formatting and text survive correctly.

### Concurrent block insertion

```text
User A inserts paragraph
User B inserts paragraph
```

Verify neither disappears.

### Concurrent deletion/edit

```text
User A deletes content
User B modifies nearby content
```

Verify Yjs/Plate resolves the conflict without corrupting the document.

### Reconnect

```text
User A disconnects
User A edits
User B edits
User A reconnects
```

Verify synchronization converges.

---

# 13. Undo/redo

Ensure undo/redo works correctly with collaboration.

Do not implement a separate Markdown-based undo system.

Undo should operate on the Plate/Yjs collaborative document architecture.

Be careful about:

```text
local user edits
remote user edits
undo local changes
redo local changes
```

Remote edits should not accidentally become part of the local user's undo history unless the installed Plate/Yjs history implementation explicitly behaves that way.

Use the supported Plate/Yjs history mechanism.

---

# 14. Cursor and awareness state

Keep ephemeral collaboration state separate from document content.

Examples:

```text
cursor position
selection
user name
user color
presence
online/offline
```

These should use Yjs awareness / Plate's collaboration mechanisms.

Do not persist cursor positions as document content.

---

# 15. Versioning

Separate:

```text
document content
document version
Yjs updates
Markdown snapshots
application metadata
```

A Markdown snapshot should not become the authoritative version identifier for collaborative state.

If the application already has document versions, integrate with the existing model rather than creating a second incompatible versioning system.

---

# 16. Graph/document architecture

This application is also a graph-based documentation system.

Keep the distinction between:

```text
Graph structure
```

and:

```text
Document content
```

For example:

```text
Graph Node
    ├── id
    ├── type
    ├── title
    ├── metadata
    ├── relationships
    └── document
            ↓
        Plate/Yjs
```

The graph relationship should not be encoded purely inside Markdown.

A documentation node may contain a Plate document, while the graph remains structured separately.

For example:

```text
service.payment
      │
      ├── depends_on → service.auth
      ├── publishes → event.payment.created
      └── documents → Plate document
```

This allows the AI/graph layer to understand relationships without parsing Markdown.

---

# 17. API boundaries

Create clean boundaries such as:

```text
DocumentRepository
DocumentCollaborationService
MarkdownSerializer
MarkdownImporter
```

Use the actual architecture/naming conventions already present in the repository.

Conceptually:

```text
DocumentRepository
    load
    save metadata
    find

CollaborationService
    initialize
    connect
    disconnect
    apply update
    persist update

MarkdownSerializer
    serialize Plate document → Markdown

MarkdownImporter
    deserialize Markdown → Plate document
```

Do not introduce unnecessary abstractions if the existing codebase already has suitable services.

---

# 18. Never use Markdown as a synchronization protocol

This is a hard requirement.

Do not implement:

```text
User edit
 → generate Markdown diff
 → send Markdown diff
 → merge Markdown
 → parse Markdown
 → update Plate
```

Instead:

```text
User edit
 → Plate
 → Yjs
 → synchronize Yjs state
 → Plate
```

Markdown is only:

```text
import
export
snapshot
LLM interoperability
human-readable representation
```

---

# 19. LLM integration

The application will eventually expose documentation to LLMs/agents.

Therefore maintain separate representations:

```text
Collaborative representation
    → Plate/Yjs

Human export
    → Markdown

Machine/agent representation
    → structured JSON / graph entities / relationships

LLM context
    → Markdown + structured metadata + graph context
```

Do not force the CRDT representation to also become the LLM representation.

---

# 20. Database considerations

Inspect the existing database schema before modifying it.

Do not automatically create a second copy of the entire document in:

```text
JSONB
Markdown
Yjs
```

unless there is a clear reason.

Avoid unnecessary duplication.

Prefer:

```text
Yjs collaborative state
        +
derived Markdown snapshot when required
        +
document metadata
```

If JSONB already stores the Plate document and is intentionally used as a snapshot/read model, preserve it where appropriate but make its role explicit.

Document which representation is:

```text
source of truth
derived state
cache
export
snapshot
```

---

# 21. Performance

Do not serialize the entire document to Markdown on every keystroke.

Do not recreate the entire Y.Doc on every React render.

Do not force React to rerender the entire editor for remote changes.

Use Plate/Yjs's intended incremental synchronization behavior.

For large documents, test:

```text
10 KB
100 KB
1 MB+
```

and verify editing remains responsive.

---

# 22. Failure recovery

Handle:

```text
WebSocket disconnect
provider reconnect
server restart
browser refresh
multiple tabs
offline edits
stale Markdown snapshot
failed Markdown serialization
invalid imported Markdown
invalid custom nodes
```

A failed Markdown serialization must not corrupt or discard the canonical Plate/Yjs document.

---

# 23. Migration from the existing implementation

Before implementing anything:

1. Inspect the current editor.
2. Identify how content is currently stored.
3. Identify whether Markdown is currently canonical.
4. Identify current Markdown conversion logic.
5. Identify existing Plate plugins.
6. Identify existing custom nodes.
7. Identify current save/update APIs.
8. Identify current autosave behavior.
9. Identify current document/version model.
10. Identify existing collaboration code, if any.

Then produce a short migration plan.

Do not immediately modify files.

After understanding the architecture, implement the smallest migration necessary.

Preserve existing functionality.

---

# 24. Required tests

Add tests covering:

```text
Plate → Markdown
Markdown → Plate

Plate → Yjs
Yjs → Plate

concurrent text edits
concurrent formatting
concurrent block edits
undo/redo
reconnect
offline/reconnect
custom nodes
Markdown round trip
large documents
```

Also test that:

```text
Markdown snapshot cannot overwrite newer Yjs state.
```

---

# 25. Definition of done

The final architecture should look like:

```text
                     Collaboration
                          │
                          ▼
                       Y.Doc
                          │
                    @platejs/yjs
                          │
                          ▼
                  Plate / Slate Model
                          │
                ┌─────────┴─────────┐
                │                   │
                ▼                   ▼
             React UI        Markdown Serializer
                                    │
                                    ▼
                                Markdown
```

And for import:

```text
Markdown
    │
    ▼
Markdown Deserializer
    │
    ▼
Plate Document
    │
    ▼
Yjs
```

The fundamental rule is:

**Plate/Slate structured document + Yjs is the collaborative source of truth. Markdown is a derived representation.**

Do not build a Markdown-based CRDT.

Before finishing, provide:

1. Files changed.
2. Architecture changes.
3. How Yjs is initialized.
4. How persistence works.
5. How Markdown import/export works.
6. How existing documents migrate.
7. Tests added.
8. Any remaining limitations or assumptions.

Do not introduce a new external vector database, graph database, or collaboration backend unless the existing application actually requires it.

Use the existing project conventions wherever possible.
