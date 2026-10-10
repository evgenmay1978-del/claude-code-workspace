import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface Props { source: string; compact?: boolean }
type Block = { kind: 'paragraph' | 'list' | 'code' | 'table'; text: string; language?: string; rows?: string[][]; ordered?: boolean }

function cells(line: string) { return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()) }
function isTableDivider(line: string) { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line) }

function parseText(text: string, blocks: Block[]) {
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const rows = [cells(line)]
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) { rows.push(cells(lines[index])); index += 1 }
      index -= 1
      blocks.push({ kind: 'table', text: '', rows })
      continue
    }
    const list = line.match(/^([-*]|\d+\.)\s+(.*)$/)
    if (list) blocks.push({ kind: 'list', text: list[2], ordered: /^\d/.test(list[1]) })
    else blocks.push({ kind: 'paragraph', text: line })
  }
}

function parseBlocks(source: string): Block[] {
  const parts = source.split(/```([\w-]*)\n([\s\S]*?)```/g)
  const blocks: Block[] = []
  for (let index = 0; index < parts.length; index += 3) {
    parseText(parts[index], blocks)
    if (index + 2 < parts.length) blocks.push({ kind: 'code', text: parts[index + 2], language: parts[index + 1] || 'code' })
  }
  return blocks
}

function inline(text: string) {
  const chunks = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
  return chunks.map((chunk, index) => {
    if (chunk.startsWith('`') && chunk.endsWith('`')) return <code key={index}>{chunk.slice(1, -1)}</code>
    if (chunk.startsWith('**') && chunk.endsWith('**')) return <strong key={index}>{chunk.slice(2, -2)}</strong>
    const link = chunk.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      const href = link[2].trim()
      const safe = /^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(href)
      return safe ? <a key={index} href={href} target={/^https?:\/\//i.test(href) ? '_blank' : undefined} rel={/^https?:\/\//i.test(href) ? 'noreferrer noopener' : undefined}>{link[1]}</a> : <span key={index}>{link[1]}</span>
    }
    return <span key={index}>{chunk}</span>
  })
}

export function MarkdownContent({ source, compact = false }: Props) {
  const [copied, setCopied] = useState(false)
  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }
  return <div className={`markdown-content${compact ? ' markdown-content--compact' : ''}`}>
    {parseBlocks(source).map((block, index) => {
      if (block.kind === 'code') return <div className="code-block" key={index}>
        <div className="code-block__top"><span>{block.language}</span><button className="copy-code" onClick={() => void copyCode(block.text)} aria-label="Скопировать код">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Скопировано' : 'Копировать'}</button></div>
        <pre><code>{block.text.trim()}</code></pre>
      </div>
      if (block.kind === 'table') return <div className="markdown-table-wrap" key={index}><table className="markdown-table"><thead><tr>{(block.rows?.[0] ?? []).map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead><tbody>{block.rows?.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{(block.rows?.[0] ?? []).map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? '')}</td>)}</tr>)}</tbody></table></div>
      if (block.kind === 'list') return <div className={`markdown-list${block.ordered ? ' markdown-list--ordered' : ''}`} key={index}><span className="list-dot">{block.ordered ? `${index + 1}.` : ''}</span>{inline(block.text)}</div>
      return <p key={index}>{inline(block.text)}</p>
    })}
  </div>
}
