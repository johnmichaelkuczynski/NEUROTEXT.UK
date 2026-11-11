import { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamInput } from '@workspace/api-client-react';

type StreamState =
  | 'idle'
  | 'preparing'
  | 'writing'
  | 'interrupted'
  | 'failed'
  | 'complete';

type StreamEvent =
  | { type: 'status'; status: StreamState; message?: string }
  | { type: 'token'; content: string }
  | { type: 'progress'; words: number; target: number; percent: number }
  | {
      type: 'complete';
      words: number;
      target: number;
      provider: string;
      validated: boolean;
    }
  | { type: 'error'; message: string; code: string };

export class GenerationFailure extends Error {
  partialOutput: string;
  interrupted: boolean;
  constructor(message: string, partialOutput: string, interrupted = false) {
    super(message);
    this.partialOutput = partialOutput;
    this.interrupted = interrupted;
  }
}

export function useFunctionStream() {
  const [status, setStatus] = useState<StreamState>('idle');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [progress, setProgress] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const startStream = useCallback(
    async (
      input: StreamInput,
      onChunk?: (chunk: string) => void,
      endpoint = '/api/functions/stream',
    ) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setStatus('preparing');
      setOutput(input.resumeFrom ?? '');
      setError(null);
      setProvider('');
      setProgress(0);

      let finalOutput = input.resumeFrom ?? '';
      let receivedCompletion = false;
      let failureMessage = '';

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error || `Unable to start generation (${response.status})`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('The server did not provide a readable stream.');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const dataLine = frame
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!dataLine) continue;

            const event = JSON.parse(dataLine.slice(6)) as StreamEvent;
            if (event.type === 'status') {
              setStatus(event.status);
            } else if (event.type === 'token') {
              finalOutput += event.content;
              setOutput((previous) => previous + event.content);
              onChunk?.(event.content);
            } else if (event.type === 'progress') {
              setProgress(event.percent);
            } else if (event.type === 'complete') {
              receivedCompletion = event.validated;
              setProvider(event.provider);
              setProgress(100);
              setStatus(event.validated ? 'complete' : 'failed');
            } else if (event.type === 'error') {
              failureMessage = event.message;
              setError(event.message);
              setStatus('failed');
            }
          }

          if (done) break;
        }

        if (failureMessage) throw new Error(failureMessage);
        if (!receivedCompletion) {
          setStatus('interrupted');
          throw new Error('The stream ended before validated completion.');
        }
        return finalOutput;
      } catch (caught) {
        if (controller.signal.aborted) {
          setStatus('interrupted');
          throw new GenerationFailure('Generation was interrupted. Any partial text has been retained.', finalOutput, true);
        }
        const message =
          caught instanceof Error ? caught.message : 'Generation failed';
        setError(message);
        if (!failureMessage) setStatus('failed');
        throw new GenerationFailure(message, finalOutput);
      }
    },
    [],
  );

  const interrupt = useCallback(() => {
    abortControllerRef.current?.abort();
    setStatus('interrupted');
  }, []);

  return {
    startStream,
    interrupt,
    status,
    output,
    error,
    provider,
    progress,
    setOutput,
    setStatus,
  };
}