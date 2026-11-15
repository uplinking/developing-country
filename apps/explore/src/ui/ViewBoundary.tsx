import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What failed, for the message: "map", "chart", … */
  what: string
  /** Changing this clears a caught error (a new tool result gets a fresh try). */
  resetKey?: unknown
}

interface State {
  error: Error | null
  key: unknown
}

/**
 * Keeps one failed part of the MCP App (a lazy chunk that did not load, a
 * renderer that threw on an odd result) from unmounting the whole frame. The
 * host connection, the "Open live view" link and every other part stay up.
 */
export default class ViewBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.key ? null : { error: null, key: props.resetKey }
  }

  componentDidCatch(error: Error) {
    console.error(`[mcp-app] ${this.props.what} failed`, error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="live-view-state" role="alert">
        <p>The {this.props.what} could not load here. Use “Open live view” to see it on developing-country.org.</p>
      </div>
    )
  }
}
