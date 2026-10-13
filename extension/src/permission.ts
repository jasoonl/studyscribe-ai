const allow = document.getElementById("allow") as HTMLButtonElement;
const result = document.getElementById("result")!;

allow.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    result.textContent = "Microphone allowed. Close this tab, go back to your lecture and press Record this tab again.";
    result.className = "small success";
    allow.hidden = true;
  } catch {
    result.textContent = "Chrome did not allow the microphone. You can still record the tab without it, or allow it in Chrome's settings for this extension.";
    result.className = "small error";
  }
});
