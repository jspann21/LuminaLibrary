## 2024-05-19 - Semantic Listboxes for Custom Dropdowns
**Learning:** Custom interactive dropdowns (like color pickers) implemented with generic `div` and `button` elements are completely opaque to screen readers. They read as disconnected buttons rather than a cohesive choice.
**Action:** Always apply `role="listbox"` to the container, `role="option"` with `aria-selected` to the individual choices, and `aria-expanded`/`aria-haspopup` to the trigger button when building custom select/dropdown components.
