'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps a Today view from breaking Today: if anything inside throws while
 * rendering, the fallback (Classic) renders instead for the rest of the visit.
 */
export class ViewBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Today glass view failed', error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
