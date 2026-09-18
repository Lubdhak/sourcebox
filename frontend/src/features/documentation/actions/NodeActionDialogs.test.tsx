import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DuplicateNodeDialog } from '@/features/documentation/actions/NodeActionDialogs'
import type { DocumentationNode } from '@/types'

/*
 * Deletion used to be tested here, against two dialogs. Those tests moved to
 * `deletion/DeleteNodesDialog.test.tsx` along with the implementation -- there is one
 * deletion component now, and one place that checks it.
 */

function node(overrides: Partial<DocumentationNode> = {}): DocumentationNode {
  return {
    id: 'n1',
    title: 'Order Service',
    summary: null,
    position: { x: 0, y: 0, z: 0 },
    size: { width: 240, height: 120, depth: 0 },
    metadata: {},
    ...overrides,
  }
}

describe('DuplicateNodeDialog', () => {
  it('offers the copy with or without what is inside', async () => {
    const onConfirm = vi.fn()
    render(
      <DuplicateNodeDialog node={node({ childCount: 3 })} open onOpenChange={() => {}} onConfirm={onConfirm} />,
    )

    expect(screen.getByText(/It contains 3 nodes/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'Just this node' }))
    expect(onConfirm).toHaveBeenCalledWith(false)

    await userEvent.click(screen.getByRole('button', { name: 'With everything inside' }))
    expect(onConfirm).toHaveBeenLastCalledWith(true)
  })
})
