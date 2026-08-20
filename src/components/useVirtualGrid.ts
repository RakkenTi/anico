import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Render only the rows of a grid that are on screen.
 *
 * A collection is the one screen here that can hold five figures of cards, and
 * a card is an image, a foil frame and four text nodes. Ten thousand of those
 * is tens of thousands of DOM nodes and as many decoded images: the browser
 * spends its whole frame budget on cards nobody is looking at, and a phone
 * simply gives up. Forty are mounted at a time instead, and the rest is a
 * number the container is tall enough to account for.
 *
 * Nothing is assumed about the layout. The column count is read back from the
 * grid's own computed `grid-template-columns`, and the row height from a real
 * child, so the CSS stays the authority on how the grid looks and this only
 * decides how much of it exists.
 */
export function useVirtualGrid(count: number, resetKey: unknown) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  const [rowH, setRowH] = useState(0)
  const [range, setRange] = useState({ start: 0, end: 48 })

  /** Read the grid back: how many columns it chose, and how tall a row is. */
  const measure = useCallback(() => {
    const grid = innerRef.current
    const first = grid?.firstElementChild as HTMLElement | null
    if (!grid || !first) return
    const style = getComputedStyle(grid)
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length || 1
    const gap = parseFloat(style.rowGap || '0') || 0
    const height = first.getBoundingClientRect().height + gap
    if (columns !== cols) setCols(columns)
    if (height > 0 && Math.abs(height - rowH) > 0.5) setRowH(height)
  }, [cols, rowH])

  const update = useCallback(() => {
    const el = outerRef.current
    if (!el || rowH <= 0) return
    const rect = el.getBoundingClientRect()
    const viewport = window.innerHeight || 800
    // How far the top of the grid has travelled above the fold, and how much
    // of it the screen can see. One screenful of overscan either side keeps a
    // fast flick from ever showing a hole.
    const above = Math.max(0, -rect.top)
    const startRow = Math.max(0, Math.floor((above - viewport) / rowH))
    const endRow = Math.ceil((above + viewport * 2) / rowH)
    const start = startRow * cols
    const end = Math.min(count, endRow * cols)
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [cols, rowH, count])

  // Any ancestor may be the thing that scrolls -- the window on a desktop, a
  // pane on a phone -- so the listener is captured at the document rather than
  // bound to a guess.
  useEffect(() => {
    const onScroll = () => update()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
    }
  }, [update])

  // Re-measure whenever the layout could have changed underneath us: a
  // different filter, a resize, a card that grew a star.
  useEffect(() => {
    measure()
    update()
  }, [measure, update, resetKey, count])

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      measure()
      update()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, update])

  const rows = rowH > 0 ? Math.ceil(count / cols) : 0
  const start = rowH > 0 ? range.start : 0
  const end = rowH > 0 ? Math.min(count, Math.max(range.end, cols * 6)) : Math.min(count, 48)
  return {
    outerRef,
    innerRef,
    start,
    end,
    /** Height the whole grid would have, so the scrollbar tells the truth. */
    totalHeight: rows > 0 ? rows * rowH : undefined,
    /** Where the mounted slice has to sit inside it. */
    offset: rowH > 0 ? Math.floor(start / cols) * rowH : 0,
  }
}
