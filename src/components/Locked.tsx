/**
 * A page the demo cannot honestly offer.
 *
 * Darkened and labelled rather than hidden, because the point of a demo is to
 * show what the thing is: a visitor deciding whether to run this themselves
 * should be able to see the door, read why it is shut here, and find the way
 * to open it.
 *
 * Never rendered outside the demo build -- `DEMO` folds away and takes this
 * with it.
 */
import Icon from './Icon'

export default function Locked({
  title,
  href,
  children,
}: {
  title: string
  href: string
  children: React.ReactNode
}) {
  return (
    <div className="panel locked-panel">
      <span className="locked-mark" aria-hidden="true">
        <Icon name="pouch" />
      </span>
      <h2 className="section-title">{title}</h2>
      <p className="locked-body">{children}</p>
      <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer noopener">
        Run your own instance
      </a>
    </div>
  )
}
