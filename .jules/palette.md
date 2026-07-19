## 2024-07-19 - Standardized Loading Spinners
**Learning:** Animated loading spinners built from standard icons (like `lucide-react` `Loader2` with Tailwind `animate-spin`) are more visually appealing and cohesive than static text elements ("Loading..."), providing better user feedback during asynchronous operations across differing UI zones.
**Action:** Always favor standard UI spinners combined with semantic text (e.g., `<Loader2 className="animate-spin" /> Loading library...`) when building async loading states, ensuring consistency with the broader design system.
