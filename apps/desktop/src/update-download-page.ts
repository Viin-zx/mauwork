/** The download page offered to an installation that cannot update itself. */

import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { formatDesktopMessage, type DesktopMessages } from './locale.ts'

/** Product page serving the current macOS and Windows installers. */
export const UPDATE_DOWNLOAD_PAGE_URL = 'https://mauwork.zrshuiwu.com'

interface DownloadPageOperations {
  /** The copy for the current Desktop locale. */
  messages(): DesktopMessages
  show(options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  /** Opens one http(s) URL in the default browser; a rejected promise means it could not. */
  open(url: string): Promise<unknown>
}

/**
 * Offer the product page when this installation carries no update feed — an
 * unsigned macOS bundle, which Squirrel.Mac cannot install an update for.
 * @param operations - localized copy, the native dialog, and the browser opener.
 * @returns once the dialog settled and any chosen link was opened or reported.
 */
export async function offerDownloadPage(operations: DownloadPageOperations): Promise<void> {
  const messages = operations.messages()
  const { response } = await operations.show({
    type: 'info',
    title: messages.updateUnavailableTitle,
    message: messages.updateUnavailableSummary,
    detail: formatDesktopMessage(messages.updateUnavailableDetail, { url: UPDATE_DOWNLOAD_PAGE_URL }),
    buttons: [messages.mandatoryPage, messages.close],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0) return
  try {
    await operations.open(UPDATE_DOWNLOAD_PAGE_URL)
  } catch {
    await operations.show({
      type: 'error',
      title: messages.updateUnavailableTitle,
      message: messages.mandatoryPageFailed,
      detail: UPDATE_DOWNLOAD_PAGE_URL,
      buttons: [messages.close],
    })
  }
}
