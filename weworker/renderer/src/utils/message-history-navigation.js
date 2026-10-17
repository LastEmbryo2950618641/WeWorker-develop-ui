export function getHistoryMessagePreview(message, maxLength = 240) {
  const text = (message?.content ?? [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (text) return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
  return message?.role === 'user' ? '用户消息' : '助手消息'
}

export function findClosestHistoryMessageIndex(count, getTop, targetY) {
  if (count <= 0) return -1

  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (getTop(middle) < targetY) low = middle + 1
    else high = middle
  }

  const after = low
  const before = Math.max(0, after - 1)
  return Math.abs(getTop(before) - targetY) <= Math.abs(getTop(after) - targetY) ? before : after
}
