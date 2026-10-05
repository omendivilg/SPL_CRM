---
name: design-system
description: "Use SPL's existing visual language for web or mobile UI work in this repository."
---

# SPL design system

## Purpose

Keep SPL web and mobile interfaces visually consistent with the actual implementation.

## When to use

Use for SPL layout, component, color, typography, responsive, and accessibility changes.

## When not to use

Do not use in another repository or for backend-only work.
Do not treat the documented palette as permission to override working components.

## Required context

Inspect the affected UI, `src/styles.css`, feature CSS, `mobile/src/theme.ts`, and nearby components.
For Expo or React Native API changes, follow `mobile/AGENTS.md` and the matching versioned docs.

## Mandatory procedure

- Inspect the current screen and reusable component patterns before editing.
- Reuse the existing dark, discreet, professional, audio-oriented visual language.
- Compare web tokens in `src/styles.css` with mobile colors in `mobile/src/theme.ts`.
- Treat burnt amber `#EA580C`, slate `#94A3B8`, and ivory white `#F8FAFC` as brand references; existing implemented shades and contrast rules control local decisions.
- Check loading, error, empty, focus, hover, touch, and small-screen states where applicable.
- Inspect the rendered result at relevant desktop, tablet, and phone sizes.

## Validation

Check contrast, readable text, keyboard or touch targets, responsive layout, and visual consistency with adjacent screens.
Run the relevant UI lint, type, and test checks available in the repository.

## Restrictions

Do not introduce a parallel token system or replace existing visual primitives without a concrete reason.
Do not modify API or business logic under this skill alone.

## Expected output

Report affected screens, reused tokens or components, visual checks, and remaining limitations.

## Definition of done

The UI works and looks consistent with SPL at supported sizes and input methods.
