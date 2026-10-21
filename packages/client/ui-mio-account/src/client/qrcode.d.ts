/** Browser-only QR renderer used by the purchase dialog. */
declare module 'qrcode/lib/browser.js' {
  /** Options accepted by the browser PNG renderer. */
  interface BrowserQRCodeOptions {
    /** Quiet-zone width in modules. */
    margin?: number
    /** Output edge length in pixels. */
    width?: number
  }

  /**
   * Render text as a PNG data URL.
   * @param text - payload to encode.
   * @param options - size and quiet-zone options.
   * @returns the data URL.
   */
  export function toDataURL(text: string, options?: BrowserQRCodeOptions): Promise<string>
}
