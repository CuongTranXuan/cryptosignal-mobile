import type { CopilotFeedbackClient } from "./copilot-feedback";

let activeClient: CopilotFeedbackClient | null = null;

export function setCopilotFeedbackClient(client: CopilotFeedbackClient | null): void {
  activeClient = client;
}

export function getCopilotFeedbackClient(): CopilotFeedbackClient | null {
  return activeClient;
}
