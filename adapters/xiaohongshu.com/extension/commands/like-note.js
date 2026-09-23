/* v2 command xiaohongshu.com.like-note; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("like-note", async function (params) {
    return window["__xiaohongshu_com_internal"].invoke("xiaohongshu.com.like_note", params || {});
  });
})();
