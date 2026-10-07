// Applies the saved light/dark choice and text size before the page draws,
// so it never flashes the wrong look. With no saved choice, the device setting is used.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("sageTheme");
  } catch (e) {}
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  var size = null;
  try {
    size = localStorage.getItem("sageTextSize");
  } catch (e) {}
  if (size === "1.15" || size === "1.3") document.documentElement.style.setProperty("--text-scale", size);
})();
