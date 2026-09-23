/* v2 command xiaohongshu.com.navigate-to-homepage; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("navigate-to-homepage", async function (params) {
    return window["__xiaohongshu_com_internal"].invoke("xiaohongshu.com.navigate_to_homepage", params || {});
  });
})();
