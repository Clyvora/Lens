import { useId } from 'react'

interface Choice { value: string; label: string; description?: string }
interface Props { label: string; value: string; choices: Choice[]; onChange: (value: string) => void; disabled?: boolean }

export function ChoiceGroup({ label, value, choices, onChange, disabled }: Props) {
  const name = useId()
  return <fieldset className="choice-group" disabled={disabled}>
    <legend>{label}</legend>
    <div className="choice-grid">
      {choices.map(choice => <label className="choice-card" key={choice.value}>
        <input type="radio" aria-label={`${choice.label}${choice.description ? ` ${choice.description}` : ''}`} name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
        <span className="choice-label">{choice.label}</span>
        {choice.description && <span className="choice-description">{choice.description}</span>}
      </label>)}
    </div>
  </fieldset>
}
