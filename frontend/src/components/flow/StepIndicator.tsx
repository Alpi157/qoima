import { CheckIcon } from '../icons'

export interface StepIndicatorProps {
  /** Step names in order: «Тауарлар», «Сатып алушы», «Тексеру». */
  steps: string[]
  /** 1-based. */
  current: number
  label: string
}

/** Where the user is in a flow of several steps; done steps get a check. */
export function StepIndicator({ steps, current, label }: StepIndicatorProps) {
  return (
    <ol className="flow-steps" aria-label={label}>
      {steps.map((name, index) => {
        const number = index + 1
        const state = number < current ? 'done' : number === current ? 'current' : 'next'
        return (
          <li
            key={name}
            className="flow-step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="flow-step-number">
              {state === 'done' ? <CheckIcon size={20} /> : number}
            </span>
            <span className="flow-step-label">{name}</span>
          </li>
        )
      })}
    </ol>
  )
}
