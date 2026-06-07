import type { OptionItem } from '../../../../types'

interface OptionsProps {
  items: OptionItem[]
  onSelect?: (id: string) => void
}

function getOptionTestId(label: string): string {
  return `chat-option-${label.trim().toLowerCase().replace(/\s+/g, '-')}`
}

export function Options({ items, onSelect }: OptionsProps) {
  if (items.length === 0) return null

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <button
          key={item.id}
          type='button'
          aria-label={`Chat option: ${item.label}`}
          data-testid={getOptionTestId(item.label)}
          onClick={() => onSelect?.(item.value ?? item.id)}
          className='rounded-full border border-[var(--divider)] bg-[var(--bg)] px-3.5 py-1.5 font-[430] font-[family-name:var(--font-inter)] text-[var(--text-primary)] text-sm leading-5 transition-colors hover-hover:bg-[var(--surface-5)]'
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
