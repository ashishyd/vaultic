import { useEscapeKey } from '../lib/use-escape-key'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

/** Full-size image viewer overlay — click the backdrop, press Escape, or hit Close to dismiss. */
export function ImageLightbox({ src, alt = '', onClose }: ImageLightboxProps): JSX.Element {
  useEscapeKey(onClose, true, true)

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-10"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-6 top-6 rounded-lg border border-white/20 bg-black/40 px-3 py-1.5 text-sm text-white hover:bg-black/60"
      >
        Close
      </button>
    </div>
  )
}
