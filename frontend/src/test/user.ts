import userEvent from '@testing-library/user-event'

/**
 * userEvent without the default pause between key presses. The pause is a setTimeout per
 * character; typing an article or a price in every test made the full run several times slower.
 */
export function setupUser() {
  return userEvent.setup({ delay: null })
}

export type TestUser = ReturnType<typeof setupUser>

/**
 * Puts text into a field as one paste. Each typed character re-renders the whole form, so
 * long values go through here; user.type stays for tests of key-by-key behaviour.
 */
export async function fill(user: TestUser, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}
