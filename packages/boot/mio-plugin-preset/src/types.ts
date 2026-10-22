/** Client-safe event contract for a catalog preset written by the Host. */

/** One forced installation whose preset write completed. */
export interface MioPluginPresetApplied {
  /** Installed bundle package name. */
  readonly packageName: string
  /** Settings entry that received the preset. */
  readonly target: string
  /** Whether this Host process detected the installation and should refresh the renderer. */
  readonly reload: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A mioagent catalog preset was written to an installed plugin's settings entry.
     * @mode emit
     * @param change - package, target entry, and whether this Host process detected the installation.
     */
    'mio-plugin-preset/applied'(change: MioPluginPresetApplied): void
  }
}
