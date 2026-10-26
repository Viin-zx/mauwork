/** Client-safe event contracts for the catalog defaults and presets the Host applies. */

/** One forced installation whose preset write completed. */
export interface MioPluginPresetApplied {
  /** Installed bundle package name. */
  readonly packageName: string
  /** Settings entry that received the preset. */
  readonly target: string
  /** Whether this Host process detected the installation and should refresh the renderer. */
  readonly reload: boolean
}

/** One defaults pass that installed catalog packages. */
export interface MioPluginDefaultsInstalled {
  /** Packages this pass installed. */
  readonly packages: readonly string[]
  /** Whether at least one installation applies without a restart, so a renderer reload loads it. */
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
    /**
     * The catalog defaults installed packages for this profile.
     * @mode emit
     * @param change - installed packages and whether the renderer can load them now.
     */
    'mio-plugin-preset/defaults-installed'(change: MioPluginDefaultsInstalled): void
  }
}
