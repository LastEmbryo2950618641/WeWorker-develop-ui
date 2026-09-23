/* v2 command xiaohongshu.com.open-note; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("open-note", async function (params) {
    return window["__xiaohongshu_com_internal"].invoke("xiaohongshu.com.open_note", params || {});
  });
})();
