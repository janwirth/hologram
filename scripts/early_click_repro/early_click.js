// Injected by Lightpanda before the page's scripts: clicks the counter's "+1" as soon as the
// server's HTML is parsed, before the runtime has rendered, then reports the count 3 s later.
document.addEventListener("DOMContentLoaded", () => {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "+1",
  );
  button.click();
  setTimeout(() => {
    window.__count = document.querySelector("#count").textContent.trim();
  }, 3000);
});
