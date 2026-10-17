import React from 'react'
import './app-switch.css'

export default function AppSwitch({ className = '', ...props }) {
  return (
    <span className={`app-switch ${className}`.trim()}>
      <input {...props} type="checkbox" role="switch" className="app-switch__input" />
      <span className="app-switch__track" aria-hidden="true" />
    </span>
  )
}
