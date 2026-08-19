import { useEffect } from 'react'
import { useGame } from '../game/store'
import type { Toast } from '../game/types'

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useGame((s) => s.dismissToast)
  useEffect(() => {
    const id = setTimeout(() => dismiss(toast.id), 4000)
    return () => clearTimeout(id)
  }, [toast.id, dismiss])
  return (
    <div className={`toast toast-${toast.flavor ?? 'info'}`} onClick={() => dismiss(toast.id)}>
      {toast.text}
    </div>
  )
}

export default function ToastStack() {
  const toasts = useGame((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
