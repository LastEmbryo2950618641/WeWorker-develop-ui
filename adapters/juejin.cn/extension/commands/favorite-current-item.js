/* v2 command juejin.cn.favorite-current-item; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("favorite-current-item", async function (params) {
    return window["__juejin_cn_internal"].invoke("juejin.cn.favorite_current_item", params || {});
  });
})();
