import { useEffect, useRef } from 'react';

export function useDebounceCallback<A extends any[]>(
  callback: (...args: A) => void,
  delay: number
) {
  const timeoutRef = useRef<NodeJS.Timeout>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return (...args: A) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  };
}
