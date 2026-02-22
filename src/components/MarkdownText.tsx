import { Fragment, type ReactNode } from 'react'

interface MarkdownTextProps {
  text: string
}

function renderInline(text: string): ReactNode[] {
  // Supports **bold** without using dangerouslySetInnerHTML.
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={idx}>{part}</Fragment>
  })
}

export default function MarkdownText({ text }: MarkdownTextProps) {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Bullet list block
    if (line.trim().startsWith('- ')) {
      const items: ReactNode[] = []
      while (i < lines.length && lines[i].trim().startsWith('- ')) {
        const itemText = lines[i].trim().slice(2)
        items.push(<li key={`li-${i}`}>{renderInline(itemText)}</li>)
        i += 1
      }
      nodes.push(
        <ul key={`ul-${i}`} className="md-list">
          {items}
        </ul>,
      )
      continue
    }

    // Blank line => spacer
    if (!line.trim()) {
      nodes.push(<div key={`sp-${i}`} className="md-spacer" />)
      i += 1
      continue
    }

    nodes.push(
      <p key={`p-${i}`} className="md-paragraph">
        {renderInline(line)}
      </p>,
    )
    i += 1
  }

  return <div className="markdown-content">{nodes}</div>
}
