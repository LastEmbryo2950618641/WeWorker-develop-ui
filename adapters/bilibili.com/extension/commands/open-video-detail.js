/* v2 command bilibili.com.open-video-detail; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("open-video-detail", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.open_video_detail", params || {});
  });
})();
