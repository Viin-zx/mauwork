import { describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/locale.ts'
import { offerDownloadPage, UPDATE_DOWNLOAD_PAGE_URL } from '../src/update-download-page.ts'

/**
 * @param responses - one dialog answer per shown message box.
 * @returns the operations the dialog drives, with their calls recorded.
 */
function fixture(responses: readonly number[]) {
  let shown = 0
  const show = vi.fn(async () => ({ response: responses[shown++] ?? 1, checkboxChecked: false }))
  const open = vi.fn(async (_url: string) => undefined)
  return { show, open, operations: { messages: () => en, show, open } }
}

describe('download page for an installation without an update feed', () => {
  it('names the page and opens nothing when the offer is dismissed', async () => {
    const f = fixture([1])
    await offerDownloadPage(f.operations)

    expect(f.show).toHaveBeenCalledExactlyOnceWith({
      type: 'info',
      title: en.updateUnavailableTitle,
      message: en.updateUnavailableSummary,
      detail: en.updateUnavailableDetail.replace('{url}', UPDATE_DOWNLOAD_PAGE_URL),
      buttons: [en.mandatoryPage, en.close],
      defaultId: 0,
      cancelId: 1,
    })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('opens the product page from the download button', async () => {
    const f = fixture([0])
    await offerDownloadPage(f.operations)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(UPDATE_DOWNLOAD_PAGE_URL)
    expect(f.show).toHaveBeenCalledTimes(1)
  })

  it('reports a browser that could not open the page and keeps the link selectable', async () => {
    const f = fixture([0, 0])
    f.open.mockRejectedValueOnce(new Error('no browser'))
    await offerDownloadPage(f.operations)

    expect(f.show).toHaveBeenCalledTimes(2)
    expect(f.show).toHaveBeenLastCalledWith({
      type: 'error',
      title: en.updateUnavailableTitle,
      message: en.mandatoryPageFailed,
      detail: UPDATE_DOWNLOAD_PAGE_URL,
      buttons: [en.close],
    })
  })

  it('uses the Chinese copy when the Desktop locale is Chinese', async () => {
    const show = vi.fn(async () => ({ response: 1, checkboxChecked: false }))
    await offerDownloadPage({ messages: () => zh, show, open: vi.fn() })
    expect(show).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      title: zh.updateUnavailableTitle,
      message: zh.updateUnavailableSummary,
      buttons: [zh.mandatoryPage, zh.close],
    }))
  })
})
