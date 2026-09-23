/* v2 command bilibili.com.read-comments; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("read-comments", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.read_comments", params || {});
  });
})();
