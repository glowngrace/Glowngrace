import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { LoadingContext, type LoadingState, type LoadingTask } from './LoadingContext';

const idle: LoadingState = { pending: 0, busy: false, label: '' };

export function LoadingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadingState>(idle);
  // A ref, not state: releasing a task must never be able to lose a decrement
  // to a batched re-render, or the bar would hang on forever.
  const pendingRef = useRef(0);
  const location = useLocation();

  const start = useCallback((task: LoadingTask) => {
    pendingRef.current += 1;
    setState({ pending: pendingRef.current, busy: true, label: task.label });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setState(pendingRef.current > 0
        ? { pending: pendingRef.current, busy: true, label: task.label }
        : idle);
    };
  }, []);

  // Every route change is a new page, so the top bar sweeps while the next
  // screen settles. It is released on the next frame, which is enough to cover
  // the commit without leaving a permanent spinner on a static page.
  useEffect(() => {
    setState((current) => (current.busy ? current : { pending: current.pending, busy: true, label: '' }));
    const timer = window.setTimeout(() => {
      if (pendingRef.current === 0) setState(idle);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  const value = useMemo(() => ({ state, start }), [state, start]);

  return (
    <LoadingContext.Provider value={value}>
      <RouteProgressBar state={state} />
      {children}
    </LoadingContext.Provider>
  );
}

function RouteProgressBar({ state }: { state: LoadingState }) {
  return (
    <div
      className={state.busy ? 'route-progress is-active' : 'route-progress'}
      role="progressbar"
      aria-label="Page loading"
      aria-busy={state.busy}
      aria-hidden={!state.busy}
      data-testid="route-progress"
    >
      <span className="route-progress-bar" />
    </div>
  );
}
