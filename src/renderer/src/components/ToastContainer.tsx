import { useToastStore } from '../stores/toast-store'

const TONE_STYLES: Record<string, string> = {
  success: 'border-vt-teal/40 bg-vt-surface text-vt-teal',
  error: 'border-vt-danger/40 bg-vt-surface text-vt-danger',
  info: 'border-vt-border bg-vt-surface text-vt-text'
}

export function ToastContainer(): JSX.Element {
  const { toasts, remove } = useToastStore()

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 text-sm shadow-2xl ${TONE_STYLES[toast.tone]}`}
        >
          <span className="cursor-pointer" onClick={() => remove(toast.id)}>
            {toast.message}
          </span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick()
                remove(toast.id)
              }}
              className="rounded-md bg-vt-teal px-2 py-0.5 text-xs font-medium text-vt-bg hover:brightness-110"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
