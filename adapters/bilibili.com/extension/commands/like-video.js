/* v2 command bilibili.com.like-video; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("like-video", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.like_video", params || {});
  });
})();
