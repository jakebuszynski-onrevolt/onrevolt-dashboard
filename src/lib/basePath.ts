export const BASE_PATH =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BASE_PATH) || '';
export const apiPath = (p: string) => `${BASE_PATH}${p}`;
