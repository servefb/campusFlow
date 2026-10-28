/**
 * 把一段二进制内容存成文件（触发浏览器下载）。
 *
 * <p>为什么一定要 `URL.revokeObjectURL`：`createObjectURL` 生成的 URL 会让浏览器
 * **一直持有**那个 Blob（直到页面卸载或显式释放）。导出几十 MB 的 CSV 时连点几次，
 * 就是几百 MB 常驻内存 —— 这类问题不会当场报错，只会在用户「用了一会儿之后」表现为页面卡死，
 * 极难归因。所以用完立刻释放。
 *
 * <p>为什么不直接 `window.open(url)`：那样文件名由浏览器猜（通常变成一串 UUID），
 * 而导出文件是要归档的，名字必须能看出「是什么、哪天的」。`<a download>` 才能指定文件名。
 */
export const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // 锚点必须真的挂在文档里才触发下载（Firefox 尤其严格）
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
