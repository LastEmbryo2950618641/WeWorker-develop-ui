/* v2 command xiaohongshu.com.search-notes; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("search-notes", async function (params) {
    return window["__xiaohongshu_com_internal"].invoke("xiaohongshu.com.search_notes", params || {});
  });
})();
