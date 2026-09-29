import { createContext, useContext } from 'react';

export type LoadingTask = {
  /** A stable id so a task can be released exactly once. */
  id: string;
  /** Human readable work description, used for the announce text. */
  label: string;
};

export type LoadingState = {
  /** Number of requests currently in flight. */
  pending: number;
  /** True while any tracked request is outstanding. */
  busy: boolean;
  /** Label of the most recently started tracked request. */
  label: string;
};

export const LoadingContext = createContext<{
  state: LoadingState;
  start: (task: LoadingTask) => () => void;
}>({
  state: { pending: 0, busy: false, label: '' },
  start: () => () => undefined,
});

export function useLoading() {
  return useContext(LoadingContext);
}

/** Reads only the loading state, which is all a consumer usually needs. */
export function useLoadingState() {
  return useContext(LoadingContext).state;
}
