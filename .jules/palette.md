## 2024-08-02 - Custom Modals need ARIA and Keyboard Navigation
**Learning:** Custom modals using standard div elements lack native dialog behaviors, making them inaccessible to screen readers and difficult to use via keyboard.
**Action:** Always add `role="dialog"`, `aria-modal="true"`, and a `keydown` listener for the `Escape` key to custom modals to ensure a standard, accessible experience.
