/* v2 command bilibili.com.search-videos; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("search-videos", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.search_videos", params || {});
  });
})();
