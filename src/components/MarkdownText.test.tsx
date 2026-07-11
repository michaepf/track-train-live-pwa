import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import MarkdownText from './MarkdownText.tsx'

function render(text: string): string {
  return renderToStaticMarkup(<MarkdownText text={text} />)
}

describe('MarkdownText lists', () => {
  it('renders blank-separated repeated markers as one numbered list', () => {
    const html = render('1. First\n\n1. Second\n\n1. Third')

    expect(html.match(/<ol/g)).toHaveLength(1)
    expect(html.match(/<li/g)).toHaveLength(3)
    expect(html).toContain('<li>First</li><li>Second</li><li>Third</li>')
  })

  it('keeps lists separated by paragraph content distinct', () => {
    const html = render('1. First\n\nBetween lists\n\n1. Second')

    expect(html.match(/<ol/g)).toHaveLength(2)
  })

  it('renders blank-separated bullets as one list', () => {
    const html = render('- First\n\n- Second\n\n- Third')

    expect(html.match(/<ul/g)).toHaveLength(1)
    expect(html.match(/<li/g)).toHaveLength(3)
  })
})
