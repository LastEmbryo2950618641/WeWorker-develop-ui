/* v2 command nnfp.jss.com.cn.download-invoice; delegates to the preserved executable implementation. */
(function () {
  __webcliRegisterCommand("download-invoice", async function (params) {
    return window["__nnfp_jss_com_cn_internal"].invoke("nnfp.jss.com.cn.download_invoice", params || {});
  });
})();
