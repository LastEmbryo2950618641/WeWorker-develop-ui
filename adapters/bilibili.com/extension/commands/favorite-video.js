/* v2 command bilibili.com.favorite-video; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("favorite-video", async function (params) {
    return window["__bilibili_com_internal"].invoke("bilibili.com.favorite_video", params || {});
  });
})();
