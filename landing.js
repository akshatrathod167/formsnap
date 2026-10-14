
"use strict";

// =========================================
// FORMSNAP — LANDING PAGE INTERACTIONS
// =========================================

const themeToggle = document.querySelector("#theme-toggle");
const themeIcon = document.querySelector("#theme-icon");
const currentYear = document.querySelector("#current-year");

function setLandingTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  if (themeIcon) {
    themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  if (themeToggle) {
    const nextTheme = theme === "dark" ? "light" : "dark";

    themeToggle.setAttribute(
      "aria-label",
      `Switch to ${nextTheme} mode`
    );

    themeToggle.setAttribute(
      "title",
      `Switch to ${nextTheme} mode`
    );
  }

  try {
    localStorage.setItem("formsnap-theme", theme);
  } catch (error) {
    // Theme switching still works without local storage.
  }
}

if (themeToggle) {
  const currentTheme =
    document.documentElement.getAttribute("data-theme") || "light";

  setLandingTheme(currentTheme);

  themeToggle.addEventListener("click", () => {
    const current =
      document.documentElement.getAttribute("data-theme");

    setLandingTheme(current === "dark" ? "light" : "dark");
  });
}

if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}
