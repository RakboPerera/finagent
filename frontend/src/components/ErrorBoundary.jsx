import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
          <h2 style={{ color: '#dc2626', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ marginBottom: 16 }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button
            className="btn btn-primary"
            onClick={() => { this.setState({ hasError: false, error: null }); }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
