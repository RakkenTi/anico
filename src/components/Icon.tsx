import { ICONS, type IconName } from '../game/icons'

interface Props {
  name: IconName
  /** Extra class for sizing, e.g. the tab or badge variants. */
  className?: string
  title?: string
}

/**
 * One icon, painted as a mask over `currentColor`. See src/game/icons.ts for
 * the art and where it came from.
 */
export default function Icon({ name, className, title }: Props) {
  const url = ICONS[name] ?? ICONS.card
  return (
    <span
      className={`icon ${className ?? ''}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      style={{
        // Quoted deliberately: Vite inlines small SVGs as data URIs that carry
        // single quotes of their own, and an *unquoted* CSS url() token may
        // not contain a quote. Without these the whole declaration is dropped
        // and every icon paints as a solid square.
        ['--icon' as string]: `url("${url}")`,
      }}
    />
  )
}
