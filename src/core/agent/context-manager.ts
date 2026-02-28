import type { CoreMessageFormat } from "../../db/queries.ts";

const MAX_MESSAGES = 20;
const KEEP_RECENT_TURNS = 6; // 6 turns = 12 messages (user + assistant pairs)
const KEEP_RECENT_MESSAGES = KEEP_RECENT_TURNS * 2;

export function trimContext(messages: CoreMessageFormat[]): CoreMessageFormat[] {
  if (messages.length <= MAX_MESSAGES) {
    return messages;
  }

  const oldMessages = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
  const recentMessages = messages.slice(messages.length - KEEP_RECENT_MESSAGES);

  const summary = buildSummary(oldMessages);

  // Use role "user" for the summary so that the conversation always starts with a user message.
  // Some providers require conversations to begin with a user turn.
  return [
    { role: "user" as const, content: summary },
    ...recentMessages,
  ];
}

function buildSummary(messages: CoreMessageFormat[]): string {
  const userMessages = messages.filter((m) => m.role === "user");
  const topics = userMessages
    .map((m) => m.content.slice(0, 80))
    .slice(0, 5);

  const topicList = topics.length > 0
    ? topics.map((t) => `- ${t}`).join("\n")
    : "- General conversation";

  return `[Conversation summary — ${messages.length} earlier messages condensed]

Topics discussed:
${topicList}

The conversation continues below with the most recent messages.`;
}
