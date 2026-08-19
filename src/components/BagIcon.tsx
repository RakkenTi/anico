/** Shop bag glyph. Sized in em and painted in currentColor so it follows
    the tab's hover and active states, like the other icon tabs. */
export default function BagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.6 5.2h10.8l-1 8.4a1 1 0 0 1-1 .9H4.6a1 1 0 0 1-1-.9z" />
      <path d="M5.6 6.6V4.4a2.4 2.4 0 0 1 4.8 0v2.2" strokeLinecap="round" />
    </svg>
  )
}
