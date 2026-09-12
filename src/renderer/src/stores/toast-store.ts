import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  action?: ToastAction
}

interface PushOptions {
  action?: ToastAction
  durationMs?: number
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, tone?: ToastTone, options?: PushOptions) => void
  remove: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, tone = 'info', options) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, tone, action: options?.action }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, options?.durationMs ?? 3500)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
