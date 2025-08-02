let selectedPath = null;

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("browseBtn").addEventListener("click", async () => {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
      selectedPath = filePath;
      document.getElementById("filePath").textContent = filePath;
    } else {
      document.getElementById("filePath").textContent = "No file selected";
    }
  });

  document.getElementById("startBtn").addEventListener("click", () => {
    if (!selectedPath) {
      log("❌ Please select links.txt first!");
      return;
    }
    window.electronAPI.startDownload(selectedPath);
  });

  document.getElementById("stopBtn").addEventListener("click", () => {
    window.electronAPI.stopDownload();
    log("⛔ Stop requested.");
  });

  document.getElementById("skipBtn").addEventListener("click", () => {
    window.electronAPI.skipDownload();
    log("⏭️ Skip requested.");
  });

  document.getElementById("minimize").addEventListener("click", () => {
    window.electronAPI.windowControl("minimize");
  });

  document.getElementById("maximize").addEventListener("click", () => {
    window.electronAPI.windowControl("maximize");
  });

  document.getElementById("close").addEventListener("click", () => {
    window.electronAPI.windowControl("close");
  });

  window.electronAPI.onLog((msg) => {
    const logBox = document.getElementById("logBox");

    const line = document.createElement("div");
    line.textContent = msg;
    line.className = "log-line";

    if (msg.includes("✅")) line.style.color = "#4caf50";
    else if (msg.includes("❌") || msg.toLowerCase().includes("error"))
      line.style.color = "#f44336";
    else if (msg.includes("🔍") || msg.includes("⏳") || msg.includes("⚠️"))
      line.style.color = "#ff9800";
    else if (msg.includes("📎") || msg.includes("🌐") || msg.includes("⬇️"))
      line.style.color = "#2196f3";

    line.style.opacity = 0;
    logBox.appendChild(line);

    requestAnimationFrame(() => {
      line.style.transition = "opacity 0.4s ease";
      line.style.opacity = 1;
    });

    logBox.scrollTop = logBox.scrollHeight;
  });
});

function log(text) {
  const logBox = document.getElementById("logBox");
  const line = document.createElement("div");
  line.textContent = text;
  line.className = "log-line";
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}
