'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { errorLogger } from '@/lib/utils/error-logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class RAMSErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to our error logging system
    errorLogger.logError({
      error: new Error(`RAMS Component Error: ${error.message}`),
      componentName: 'RAMSErrorBoundary',
      additionalData: {
        componentStack: errorInfo.componentStack,
        originalError: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        timestamp: new Date().toISOString(),
      },
    });

    this.setState({
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    
    // Reload the page to reset state
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="container mx-auto p-6 max-w-4xl">
          <Card className="bg-white dark:bg-slate-900 border-red-200 dark:border-red-800">
            <CardContent className="pt-6">
              <div className="text-center space-y-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20">
                  <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                    Something went wrong
                  </h2>
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    We encountered an error while loading this RAMS content.
                  </p>
                  
                  {this.state.error && (
                    <details className="text-left bg-slate-50 dark:bg-slate-800 rounded-lg p-4 mb-4">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                        Technical Details
                      </summary>
                      <div className="text-xs font-mono text-slate-600 dark:text-slate-400 space-y-2">
                        <div>
                          <strong>Error:</strong> {this.state.error.message}
                        </div>
                        {this.state.error.stack && (
                          <div>
                            <strong>Stack:</strong>
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words">
                              {this.state.error.stack}
                            </pre>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>

                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={this.handleReset}
                    className="bg-rams hover:bg-rams-dark text-white"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reload Page
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.history.back()}
                    className="border-slate-600 text-slate-700 dark:text-slate-300"
                  >
                    Go Back
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
