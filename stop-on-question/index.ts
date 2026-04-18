import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import nlp from "compromise";

export default function (pi: ExtensionAPI) {
  pi.on("turn_end", async (event, ctx) => {
    const msg = event.message;
    if (msg.role !== "assistant") return;

    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // Use the last ~500 chars to avoid parsing huge responses
    const tail = text.slice(-500);
    const questions = nlp(tail).questions().json();

    if (questions.length > 0) {
      ctx.abort();
    }
  });
}
