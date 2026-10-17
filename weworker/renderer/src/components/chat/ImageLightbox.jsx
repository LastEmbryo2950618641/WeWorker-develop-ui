import React, { useEffect } from 'react'

export default function ImageLightbox({ src, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
        cursor: 'zoom-out',
      }}
    >
      <img
        src={src}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          borderRadius: 8,
          boxShadow: 'none',
          cursor: 'default',
        }}
        alt="screenshot"
      />
      <button
        onClick={onClose}
        style={{
          position: 'fixed', top: 20, right: 24,
          background: 'rgba(255,255,255,0.15)',
          border: 'none', borderRadius: '50%',
          color: '#fff', cursor: 'pointer',
          width: 36, height: 36, fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  )
}
