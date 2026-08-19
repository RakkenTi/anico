/** Ascending bar-chart glyph — the Stats tab's icon. Sized in em so it
    follows whatever font-size its container sets, and painted in
    currentColor so it inherits the tab's active/hover states. */
export default function BarsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.8" y="9" width="3.6" height="6" rx="0.9" />
      <rect x="6.2" y="5.4" width="3.6" height="9.6" rx="0.9" />
      <rect x="11.6" y="1.8" width="3.6" height="13.2" rx="0.9" />
    </svg>
  )
}
