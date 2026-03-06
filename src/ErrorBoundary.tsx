import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#030712] flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-[#220000] border border-[#FF0033] p-6 shadow-[0_0_30px_rgba(255,0,51,0.2)]">
            <h1 className="text-2xl font-bold text-[#FF0033] tracking-widest mb-2 font-mono flex items-center gap-2">
              <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              CRITICAL SYSTEM FAILURE
            </h1>
            <div className="bg-[#00050A] p-4 text-[#FF0033] font-mono text-sm overflow-x-auto border border-[#FF0033]/30">
              {this.state.error?.message || "Unknown rendering exception occurred."}
            </div>
            <button 
              className="mt-6 px-6 py-2 bg-[#FF0033]/20 hover:bg-[#FF0033]/40 border border-[#FF0033] text-[#FF0033] font-mono font-bold tracking-widest transition-colors w-full"
              onClick={() => window.location.reload()}
            >
              REBOOT COMBAT SYSTEM
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
