// Show the newest release number; the static text stays if GitHub can't be reached.
fetch("https://api.github.com/repos/neelsatyavolu/flint/releases/latest")
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    const v = rel && typeof rel.tag_name === "string" ? rel.tag_name.replace(/^v/, "") : "";
    if (/^\d+\.\d+\.\d+$/.test(v)) document.querySelectorAll("[data-version]").forEach((el) => { el.textContent = "Version " + v; });
  })
  .catch(() => {});
