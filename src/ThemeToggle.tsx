import { useState } from 'react'

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => globalThis.document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    globalThis.document.documentElement.dataset.theme = next
    globalThis.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#151515' : '#fafafa')
    try { localStorage.setItem('clyvora-theme', next) } catch { /* Theme remains available when storage is blocked. */ }
    setTheme(next)
  }
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      {theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>}
    </svg>
  </button>
}
