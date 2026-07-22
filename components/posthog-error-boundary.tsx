import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode, PropsWithChildren } from 'react';
import { usePostHog } from 'posthog-react-native';

interface BoundaryInnerProps extends PropsWithChildren {
  onError: (error: Error, errorInfo: ErrorInfo) => void;
}

interface BoundaryState {
  hasError: boolean;
}

class PostHogErrorBoundaryInner extends Component<BoundaryInnerProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError(error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

export function PostHogErrorBoundary({ children }: PropsWithChildren) {
  const posthog = usePostHog();

  return (
    <PostHogErrorBoundaryInner
      onError={(error, errorInfo) => {
        posthog?.captureException(error, {
          component_stack: errorInfo.componentStack ?? null,
        });
      }}
    >
      {children}
    </PostHogErrorBoundaryInner>
  );
}

// Sets up the React Native global JS error handler so uncaught exceptions
// outside the React tree (e.g. unhandled promise rejections) reach PostHog.
export function PostHogGlobalErrorHandler() {
  const posthog = usePostHog();

  useEffect(() => {
    const prev = ErrorUtils.getGlobalHandler();

    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      posthog?.captureException(error, { $is_fatal: isFatal ?? false });
      prev(error, isFatal);
    });

    return () => {
      ErrorUtils.setGlobalHandler(prev);
    };
  }, [posthog]);

  return null;
}
