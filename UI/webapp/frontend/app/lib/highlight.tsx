import type { ReactNode } from 'react'

const KW = /^(import|from|export|const|function|async|await|return|interface|type|as|keyof|typeof|new|extends)$/

/** Tiny TS tokenizer: comments, strings, numbers, calls, keywords. Returns React nodes (no innerHTML). */
export function hl(src: string): ReactNode[] {
  const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*[(<])|([A-Za-z_$][\w$]*)/g
  const out: ReactNode[] = []
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (m[1]) out.push(<span key={k++} className="tk-c">{m[1]}</span>)
    else if (m[2]) out.push(<span key={k++} className="tk-s">{m[2]}</span>)
    else if (m[3]) out.push(<span key={k++} className="tk-n">{m[3]}</span>)
    else if (m[4]) out.push(<span key={k++} className={KW.test(m[4]) ? 'tk-k' : 'tk-f'}>{m[4]}</span>)
    else out.push(KW.test(m[5]) ? <span key={k++} className="tk-k">{m[5]}</span> : m[5])
    last = re.lastIndex
  }
  if (last < src.length) out.push(src.slice(last))
  return out
}
