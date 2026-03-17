import { Fragment, type ReactNode } from 'react'

interface MarkdownTextProps {
  text: string
}

function renderInline(text: string): ReactNode[] {
  // Supports **bold** and *italic* without dangerouslySetInnerHTML.
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>
    }
    return <Fragment key={idx}>{part}</Fragment>
  })
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line.trim())
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

export default function MarkdownText({ text }: MarkdownTextProps) {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // Headers (## and ###)
    if (trimmed.startsWith('### ')) {
      nodes.push(<h4 key={`h-${i}`} className="md-heading">{renderInline(trimmed.slice(4))}</h4>)
      i += 1
      continue
    }
    if (trimmed.startsWith('## ')) {
      nodes.push(<h3 key={`h-${i}`} className="md-heading">{renderInline(trimmed.slice(3))}</h3>)
      i += 1
      continue
    }

    // Table: header row | separator row | data rows
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(trimmed)
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(parseTableRow(lines[i]))
        i += 1
      }
      nodes.push(
        <div key={`tw-${i}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>{headers.map((h, hi) => <th key={hi}>{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{renderInline(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Bullet list
    if (trimmed.startsWith('- ')) {
      const items: ReactNode[] = []
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const itemText = lines[i].trim().slice(2)
        items.push(<li key={`li-${i}`}>{renderInline(itemText)}</li>)
        i += 1
      }
      nodes.push(<ul key={`ul-${i}`} className="md-list">{items}</ul>)
      continue
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s/, '')
        items.push(<li key={`li-${i}`}>{renderInline(itemText)}</li>)
        i += 1
      }
      nodes.push(<ol key={`ol-${i}`} className="md-list">{items}</ol>)
      continue
    }

    // Blank line => spacer
    if (!trimmed) {
      nodes.push(<div key={`sp-${i}`} className="md-spacer" />)
      i += 1
      continue
    }

    // Default: paragraph
    nodes.push(
      <p key={`p-${i}`} className="md-paragraph">
        {renderInline(line)}
      </p>,
    )
    i += 1
  }

  return <div className="markdown-content">{nodes}</div>
}
