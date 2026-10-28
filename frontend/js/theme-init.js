// Runs before first paint to avoid a flash of the wrong theme.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('smartlib-theme');
  } catch (e) {}
  if (!theme) theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  try {
    if (localStorage.getItem('smartlib-sidebar') === 'collapsed' && window.innerWidth > 1024) {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.add('sidebar-collapsed');
      });
    }
  } catch (e) {}
})();
