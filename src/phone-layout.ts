import React from 'react'

export const PHONE_LAYOUT_QUERY = '(max-width: 740px)'

export function usePhoneLayout() {
  const [phone, setPhone] = React.useState(() => window.matchMedia(PHONE_LAYOUT_QUERY).matches)
  React.useEffect(() => {
    const media = window.matchMedia(PHONE_LAYOUT_QUERY)
    const update = () => setPhone(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

export function useEntryFormFocus() {
  const formRef = React.useRef<HTMLFormElement>(null)
  const nameRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    const target = window.matchMedia(PHONE_LAYOUT_QUERY).matches ? formRef.current : nameRef.current
    target?.focus({ preventScroll: true })
  }, [])
  return { formRef, nameRef }
}
