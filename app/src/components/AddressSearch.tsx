import { useEffect, useState } from 'react'
import { autocomplete, type Suggestion } from '../geosearch'

type Props = {
  onPick: (s: Suggestion) => void
  value?: string // the currently chosen address, shown until the user types
  placeholder?: string
  inputClassName?: string
  ariaLabel?: string
  clearOnPick?: boolean
}

export function AddressSearch({ onPick, value = '', placeholder = 'Search an NYC address', inputClassName, ariaLabel = 'Address', clearOnPick }: Props) {
  const [text, setText] = useState(value)
  const [results, setResults] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => setText(value), [value])

  useEffect(() => {
    if (!open || text.trim().length < 3 || text === value) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      autocomplete(text, ctrl.signal)
        .then((r) => {
          setResults(r)
          setActive(0)
        })
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [text, open, value])

  const pick = (s: Suggestion) => {
    onPick(s)
    setText(clearOnPick ? '' : s.label)
    setResults([])
    setOpen(false)
  }

  return (
    <div className="search">
      <input
        className={inputClassName}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false)
            setText((t) => (t === '' || clearOnPick ? t : value)) // an unpicked edit reverts to the chosen address
          }, 150)
        }
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && results[active]) {
            e.preventDefault()
            e.stopPropagation()
            pick(results[active])
          } else if (e.key === 'Escape') setOpen(false)
        }}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul className="suggestions" role="listbox">
          {results.map((s, i) => (
            <li
              key={s.label + i}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={() => pick(s)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
