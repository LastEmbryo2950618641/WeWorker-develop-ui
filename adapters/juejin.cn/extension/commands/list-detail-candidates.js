/* v2 command juejin.cn.list-detail-candidates; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("list-detail-candidates", async function (params) {
    return window["__juejin_cn_internal"].invoke("juejin.cn.list_detail_candidates", params || {});
  });
})();
