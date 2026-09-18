'use client';

import * as React from 'react';

import {
  useFloatingLinkEdit,
  useFloatingLinkEditState,
  useFloatingLinkInsert,
  useFloatingLinkInsertState,
} from '@platejs/link/react';
import { ExternalLink, Link2, Unlink } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Floating toolbar for the link plugin — insert mode and edit mode.
 *
 * INSERT MODE  (triggered by the "Link" toolbar button)
 *   A small popover appears near the cursor with two fields:
 *
 *     URL          — required. Press Enter or click "Add link" to confirm;
 *                    Escape cancels without inserting.
 *
 *     Display text — optional. Leave blank and the raw URL is shown as-is.
 *                    Fill it in to show friendlier text (e.g. "the runbook"
 *                    instead of "https://…") while the link still goes to
 *                    the original URL.
 *
 * EDIT MODE  (triggered when the caret is inside an existing link)
 *   A compact inline toolbar with three actions:
 *     ↗  Open the link in a new tab
 *     ✎  Re-open the insert form, pre-filled, to change the URL or text
 *     ✂  Remove the link wrapper, keeping the display text as plain text
 *
 * AUTO-LINK  (no user action needed)
 *   Handled by AutoLinkPlugin in plugins.ts. When the author types or pastes
 *   a recognisable URL (http/https/mailto) and then presses Space or Enter,
 *   it is automatically wrapped in a link. The display text defaults to the
 *   URL itself; clicking "Edit link" in the edit toolbar lets the author
 *   replace it with custom text.
 *
 * Mounted via `LinkPlugin.configure({ render: { afterEditable: LinkFloatingToolbar } })`
 * which places it inside the Plate context (editor + plugin store access)
 * while letting it float over the page with absolute positioning.
 */
export function LinkFloatingToolbar() {
  // ── Insert mode ──────────────────────────────────────────────────────────
  const insertState = useFloatingLinkInsertState();
  const insertResult = useFloatingLinkInsert(insertState);
  const {
    hidden: insertHidden,
    ref: insertRef,
    props: insertRootProps,
    input: urlInput,
    text: textInput,
  } = insertResult;

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const editState = useFloatingLinkEditState();
  const {
    hidden: editHidden,
    ref: editRef,
    props: editRootProps,
    editButtonProps,
    unlinkButtonProps,
  } = useFloatingLinkEdit(editState);

  // Nothing to render while neither mode is active.
  if (insertHidden && editHidden) return null;

  // ── Insert popover ────────────────────────────────────────────────────────
  if (!insertHidden) {
    return (
      <div
        ref={insertRef}
        {...insertRootProps}
        className={cn(
          'absolute z-50 flex min-w-[280px] flex-col gap-2 rounded-md border border-border bg-popover p-3 shadow-md',
        )}
      >
        {/* URL field – required */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">URL</label>
          <input
            {...urlInput?.props}
            placeholder="https://example.com"
            autoFocus
            className="h-8 rounded-sm border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>

        {/* Display text field – optional */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">
            Display text{' '}
            <span className="font-normal opacity-60">(optional — leave blank to show the URL)</span>
          </label>
          <input
            {...textInput?.props}
            placeholder="e.g. the runbook"
            className="h-8 rounded-sm border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          />
        </div>

        {/*
          The URL input's onKeyDown already handles Enter (confirm) and Escape
          (cancel) — no separate button needed for keyboard users. The buttons
          are here for pointer users and accessibility.
        */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-2">
          <button
            type="button"
            data-plate-prevent-deselect
            {...(insertRootProps as any)?.cancelButtonProps}
            className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            data-plate-prevent-deselect
            {...(insertRootProps as any)?.confirmButtonProps}
            className="rounded-sm bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Add link
          </button>
        </div>
      </div>
    );
  }

  // ── Edit toolbar ──────────────────────────────────────────────────────────
  const editUrl = (editState as any)?.url as string | undefined;

  return (
    <div
      ref={editRef}
      {...editRootProps}
      className={cn(
        'absolute z-50 flex items-center gap-0.5 rounded-md border border-border bg-popover p-1 shadow-md',
      )}
    >
      {/* Open the link in a new tab */}
      <button
        type="button"
        title={editUrl ?? 'Open link'}
        data-plate-prevent-deselect
        onClick={() => {
          if (editUrl) window.open(editUrl, '_blank', 'noopener,noreferrer');
        }}
        className="max-w-[200px] truncate rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <ExternalLink className="mr-1 inline size-3" />
        {editUrl ?? 'Open'}
      </button>

      <div className="mx-0.5 h-4 w-px bg-border" />

      {/* Switch to edit/insert mode, pre-filled with the current URL */}
      <button
        type="button"
        title="Edit link"
        data-plate-prevent-deselect
        {...editButtonProps}
        className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Link2 className="size-3.5" />
      </button>

      {/* Remove the link wrapper; keeps the display text as plain text */}
      <button
        type="button"
        title="Remove link"
        data-plate-prevent-deselect
        {...unlinkButtonProps}
        className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Unlink className="size-3.5" />
      </button>
    </div>
  );
}
