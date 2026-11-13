import type { FunctionWorkspace } from '@workspace/api-client-react';

// The anonymous transfer API cannot know the guest's in-memory instructions,
// output or other fields. Only the transferred content should replace memory.
export function mergeOcrDestination(destination: FunctionWorkspace, guestSnapshot?: FunctionWorkspace): FunctionWorkspace {
  return guestSnapshot ? {
    ...guestSnapshot,
    functionId: destination.functionId,
    ...(destination.functionId === 13
      ? { instructionDraft: destination.instructionDraft }
      : { sourceDocument: destination.sourceDocument }),
    updatedAt: destination.updatedAt,
  } : destination;
}
