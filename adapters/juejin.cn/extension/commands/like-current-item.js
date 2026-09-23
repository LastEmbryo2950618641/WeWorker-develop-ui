/* v2 command juejin.cn.like-current-item; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("like-current-item", async function (params) {
    return window["__juejin_cn_internal"].invoke("juejin.cn.like_current_item", params || {});
  });
})();
