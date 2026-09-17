import '@testing-library/react'

// jsdom implements neither of these, and React Flow calls both during layout. Without
// them every canvas test throws before it can assert anything.
//
// ResizeObserver: React Flow measures its container to compute the viewport transform.
// A no-op is correct for tests -- the container has no size in jsdom either way, and what
// is being asserted is the accessible structure and the mutation calls, not pixel output.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub

// DOMMatrixReadOnly: used by React Flow to read the pane's CSS transform.
if (!('DOMMatrixReadOnly' in globalThis)) {
  class DOMMatrixReadOnlyStub {
    m22 = 1
  }

  Object.defineProperty(globalThis, 'DOMMatrixReadOnly', { value: DOMMatrixReadOnlyStub })
}

// jsdom's element geometry is always zero. React Flow refuses to render nodes in a
// zero-sized pane, so the two properties it checks are given plausible values.
for (const [property, value] of [
  ['offsetHeight', 800],
  ['offsetWidth', 1200],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    value,
  })
}

// Used by the sidebar and the inspector to decide between a fixed column and a sheet.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia
