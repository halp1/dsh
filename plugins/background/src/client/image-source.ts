/**
 * Load host images through fetch, where the remote UI installs its authenticated
 * channel. CSS background URLs do not pass through that channel's src rewrite.
 * Remote image URLs remain direct so host credentials never reach third parties.
 */
export interface ImageSource {
  url: string
  dispose(): void
}

export type ImageLoader = (url: string) => Promise<ImageSource>

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export async function loadImageSource(
  url: string,
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<ImageSource> {
  if (!url.startsWith('api/dsh-background.file?')) return { url, dispose() {} }
  const response = await fetchImpl(url, { headers: { accept: 'image/*' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) throw new Error('Expected an image response')
  const objectUrl = URL.createObjectURL(blob)
  let disposed = false
  return {
    url: objectUrl,
    dispose() {
      if (disposed) return
      disposed = true
      URL.revokeObjectURL(objectUrl)
    },
  }
}
