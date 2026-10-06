// Applies the saved light/dark choice before the page draws, so it never
// flashes the wrong theme. With no saved choice, the device setting is used.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("sageTheme");
  } catch (e) {}
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
})();
