import { TextMorph } from 'torph/react'

export function MorphText({ children }: { children: string }) {
  // Keep functional labels available in browsers without the animation APIs.
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && typeof Element.prototype.animate === 'function' && typeof Element.prototype.getAnimations === 'function'
  return supported
    ? <TextMorph as="span" duration={420} respectReducedMotion>{children}</TextMorph>
    : <span>{children}</span>
}
