import { createPlatePlugin, PlateLeaf, type PlateLeafProps } from 'platejs/react'
import { Text } from 'slate'
import { cn } from '@/lib/utils'

const FLASH_KEY = 'remoteFlash'

/** How long a block stays flashed -- matches `.remote-update-flash` and
 * `.remote-update-flash-name`'s own animation duration in application.css, so the
 * decoration disappears exactly as the CSS fade finishes rather than snapping off
 * mid-animation or lingering after it. */
export const REMOTE_FLASH_MS = 3_000

/**
 * Which top-level blocks a remote Yjs update just touched, and who touched them.
 *
 * A plain mutable `Map`, not React state: every keystroke from every collaborator would
 * otherwise be a state update on top of the one Slate already does for the edit itself,
 * and this only ever needs reading at the one moment `decorate` runs. `usePlateYjsEditor`
 * owns writing to it (see its `applyRemoteEvents` wrapper); this plugin only reads.
 */
export type RemoteFlashState = Map<number, { until: number; color: string; name: string }>

/**
 * Turns `flashState` into decorations, the same way `CursorOverlayPlugin` turns Awareness
 * states into them -- registered once per editor, cheap to check on every node when
 * nothing is flashing (the common case), which is what the size check up front is for.
 */
export function createRemoteFlashPlugin(flashState: RemoteFlashState) {
  return createPlatePlugin({
    key: FLASH_KEY,
    node: { isLeaf: true },
    decorate: ({ entry }) => {
      if (flashState.size === 0) return []

      const [node, path] = entry
      if (!Text.isText(node)) return []

      const blockIndex = path[0]
      if (blockIndex === undefined) return []

      const flash = flashState.get(blockIndex)
      if (!flash || flash.until < Date.now()) return []

      // A block can be more than one leaf -- a bolded word splits its paragraph into
      // three -- and every one of them gets this decoration, so the name badge is only
      // asked for on the structurally first (every path segment after the block index is
      // 0), or a block with any formatting in it would carry one badge per leaf.
      const isFirstInBlock = path.slice(1).every((segment) => segment === 0)

      return [
        {
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
          [FLASH_KEY]: true,
          flashColor: flash.color,
          flashName: isFirstInBlock ? flash.name : undefined,
        },
      ]
    },
  }).withComponent(RemoteFlashLeaf)
}

function RemoteFlashLeaf(props: PlateLeafProps) {
  const { leaf, children } = props
  const color = typeof leaf.flashColor === 'string' ? leaf.flashColor : undefined
  const name = typeof leaf.flashName === 'string' ? leaf.flashName : null

  return (
    <PlateLeaf
      {...props}
      className={cn('remote-update-flash', name && 'relative')}
      // `--flash-color` is a custom property, which React's own CSSProperties type does
      // not model -- the cast is how every CSS-variable-via-inline-style in this codebase
      // (see cursorOverlay.tsx) says so, once, rather than fighting the type each time.
      style={color ? ({ '--flash-color': color } as React.CSSProperties) : undefined}
    >
      {name ? <span contentEditable={false} className="remote-update-flash-name">{name}</span> : null}
      {children}
    </PlateLeaf>
  )
}
