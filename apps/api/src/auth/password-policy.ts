const placeholderPasswordPattern = /(?:change[-_ ]?me|replace|example|placeholder|<[^>]+>)/i;

export function assertStrongAccountPassword(
  value: string | undefined,
  name: string,
  requiredMessageSuffix = "",
) {
  if (!value?.trim()) {
    throw new Error(`${name} is required${requiredMessageSuffix}.`);
  }
  if (value.length < 20) {
    throw new Error(`${name} must contain at least 20 characters.`);
  }
  if (placeholderPasswordPattern.test(value)) {
    throw new Error(`${name} must not contain a placeholder value.`);
  }
}
