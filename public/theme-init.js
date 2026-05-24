(function () {
  var root = document.documentElement;
  var theme = 'system';
  var accent = 'sky';

  try {
    var savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
      theme = savedTheme;
    }

    var savedAccent = localStorage.getItem('accentColor');
    if (savedAccent) {
      accent = savedAccent;
    }
  } catch (_) {
    // Keep startup paint deterministic when storage is unavailable.
  }

  var prefersDark = false;
  try {
    prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (_) {
    prefersDark = false;
  }

  var resolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedTheme);
  root.setAttribute('data-accent', accent);
  root.style.backgroundColor = resolvedTheme === 'dark' ? '#020617' : '#f8fafc';
  root.style.colorScheme = resolvedTheme;
})();
