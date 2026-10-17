export function applyAssistantStreamEvent(message, event) {
  const content = [...(message?.content ?? [])]

  if (event?.type === 'replace_assistant_content') {
    const incoming = Array.isArray(event.content) ? event.content : []
    // Preserve the turn-timing footer across content replacements (e.g. the
    // todo-gate correction swaps the assistant content AFTER turn_end already
    // appended the timing block). Timing is a meta-decoration, not part of the
    // reply, so it should survive the swap — matching how replace_assistant_text
    // keeps tool blocks. Without this, per-turn + per-step timing vanishes
    // whenever a correction fires.
    const hasTiming = incoming.some((block) => block.type === 'timing')
    const existingTiming = hasTiming ? null : content.find((block) => block.type === 'timing')
    return {
      ...message,
      content: existingTiming ? [...incoming, existingTiming] : incoming,
    }
  }

  if (event?.type === 'replace_assistant_text') {
    const withoutText = content.filter((block) => block.type !== 'text')
    const nextText = event.content ? [{ type: 'text', text: event.content }] : []
    return { ...message, content: [...withoutText, ...nextText] }
  }

  return message
}
