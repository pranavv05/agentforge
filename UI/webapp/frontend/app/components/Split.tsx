import type { ElementType, ReactNode } from 'react'

export type Seg = string | { hl: string }
type Props = { as?: ElementType; className?: string; lines: Seg[][]; now?: boolean; style?: React.CSSProperties }

/**
 * Masked word-by-word heading. Renders the exact markup the motion engine animates
 * (`.sw > .si`) so the effect works with server-rendered HTML and without touching the DOM imperatively.
 */
export function Split({ as: Tag = 'h2', className, lines, now, style }: Props) {
  let n = 0
  const label = lines.map((l) => l.map((s) => (typeof s === 'string' ? s : s.hl)).join('')).join(' ').replace(/\s+/g, ' ').trim()
  const word = (txt: string, key: string, cls = 'si') => (
    <span className="sw" aria-hidden="true" key={key}>
      <span className={cls} style={{ ['--d' as string]: `${n++ * 55}ms` }}>{txt}</span>
    </span>
  )
  const body: ReactNode[] = []
  lines.forEach((line, li) => {
    if (li > 0) body.push(<br key={`br${li}`} />)
    line.forEach((seg, si) => {
      if (typeof seg !== 'string') { body.push(word(seg.hl, `h${li}${si}`, 'hl si')); return }
      seg.split(/(\s+)/).forEach((p, pi) => {
        if (!p) return
        if (/^\s+$/.test(p)) body.push(' ')
        else body.push(word(p, `w${li}${si}${pi}`))
      })
    })
  })
  return (
    <Tag className={className} data-split="" {...(now ? { 'data-now': '' } : {})} aria-label={label} style={style}>
      {body}
    </Tag>
  )
}
