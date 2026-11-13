import type { FunctionWorkspace } from '@workspace/api-client-react';

// The anonymous transfer API cannot know the guest's in-memory instructions,
// output or other fields. Only its returned source field should replace memory.
export function mergeOcrDestination(destination: FunctionWorkspace, guestSnapshot?: FunctionWorkspace): FunctionWorkspace {
  return guestSnapshot ? {
    ...guestSnapshot,
    functionId: destination.functionId,
    sourceDocument: destination.sourceDocument,
    updatedAt: destination.updatedAt,
  } : destination;
}
