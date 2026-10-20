export function looksHard(prompt: string, files: string[]): boolean {
  return (
    files.length >= 3 ||
    prompt.length > 70 ||
    /困难|攻坚|复杂|性能|算法|架构|优化|突破|瓶颈/.test(prompt)
  )
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n…（已截断）`
}

export function summarize(text: string, max = 220): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return '（无文本输出）'
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function extractJsonObject(text: string): unknown | null {
  const cleaned = text
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}
