import { expect, type Locator } from '@playwright/test'

import budgets from './action-budget.json' with { type: 'json' }

/** One deliberate click, field fill or Enter is one action; setup and assertions are excluded. */
export class Actions {
  count = 0

  async click(locator: Locator) {
    this.count++
    await locator.click()
  }

  async fill(locator: Locator, value: string) {
    this.count++
    await locator.fill(value)
  }

  async enter(locator: Locator) {
    this.count++
    await locator.press('Enter')
  }

  check(scenario: keyof typeof budgets) {
    expect(this.count, `${scenario}: user actions`).toBeLessThanOrEqual(budgets[scenario])
  }
}
