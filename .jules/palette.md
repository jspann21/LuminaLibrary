
## 2024-08-19 - Adding ARIA Modal Attributes to Framer Motion Asides
**Learning:** When using `motion.aside` (or similar Framer Motion components) for custom side panels and modals, standard HTML ARIA attributes (`role="dialog"`, `aria-modal="true"`) must still be explicitly added to properly announce the container as a modal dialog to assistive technologies like screen readers.
**Action:** Always include `role="dialog"` and `aria-modal="true"` on modal container elements, even if they are implemented as sliding panels or using animation libraries.
