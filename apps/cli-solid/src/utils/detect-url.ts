const URL_PATTERN =
  /(?:https?:\/\/|localhost[:/]|[\w-]+\.[\w-]+\.[\w]+|[\w-]+\.(com|org|net|io|dev|app|co|me|ai))\S*/i;

export const containsUrl = (text: string): boolean => URL_PATTERN.test(text);
