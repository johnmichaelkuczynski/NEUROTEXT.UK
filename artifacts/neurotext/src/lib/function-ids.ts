import type { StreamInput } from '@workspace/api-client-react';

export function isWritingFunctionId(value: number): value is StreamInput['functionId'] {
  return Number.isInteger(value) && ((value >= 1 && value <= 10) || value === 12 || value === 13);
}
